import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import PayStubLink from './PayStubLink'
import { PayStubError, type PayStubLinkSummary } from '../../lib/payStubsApi'

const api = vi.hoisted(() => ({ lookup: vi.fn(), download: vi.fn(), downloadAll: vi.fn(), saveBlob: vi.fn() }))
vi.mock('../../lib/payStubsApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/payStubsApi')>()
  return { ...actual, payStubLinkApi: { lookup: api.lookup, download: api.download, downloadAll: api.downloadAll }, saveBlob: api.saveBlob }
})

const token = 'A'.repeat(43)
const summary = (overrides: Partial<PayStubLinkSummary> = {}): PayStubLinkSummary => ({
  state: 'active', message: null, employer: 'AIRE Services Guam', first_name: 'Mindy', expires_at: '2026-11-17T05:00:00Z', downloads_per_document: 5,
  documents: [
    { id: 11, kind: 'pay_statement', pay_date: '2026-11-15', period_start: '2026-10-26', period_end: '2026-11-08', downloads_left: 5 },
    { id: 12, kind: 'pay_statement', pay_date: '2026-10-31', period_start: null, period_end: null, downloads_left: 1 },
  ],
  ...overrides,
})

beforeEach(() => {
  vi.clearAllMocks()
  window.history.replaceState(null, '', `/stubs#t=${token}`)
})
afterEach(() => window.history.replaceState(null, '', '/'))

it('shows the first name and pay dates, then downloads with the token from the fragment', async () => {
  api.lookup.mockResolvedValue(summary())
  api.download.mockResolvedValue({ blob: new Blob(['%PDF-']), filename: 'AIRE-pay-stub-2026-11-15.pdf' })
  render(<PayStubLink />)

  expect(await screen.findByRole('heading', { name: 'Hi Mindy' })).toBeInTheDocument()
  expect(api.lookup).toHaveBeenCalledWith(token, expect.any(AbortSignal))
  expect(screen.getByText('Pay date Sun, Nov 15, 2026')).toBeInTheDocument()
  expect(screen.getByText('1 download left')).toBeInTheDocument()
  expect(document.querySelector('meta[name="referrer"]')).toHaveAttribute('content', 'no-referrer')
  expect(document.body.textContent).not.toMatch(/\$/)

  fireEvent.click(screen.getByRole('button', { name: 'Download pay stub for Sun, Nov 15, 2026' }))
  await waitFor(() => expect(api.saveBlob).toHaveBeenCalledWith(expect.any(Blob), 'AIRE-pay-stub-2026-11-15.pdf'))
  expect(api.download).toHaveBeenCalledWith(token, 11)
  expect(api.lookup).toHaveBeenCalledTimes(2)
})

it('offers one combined PDF when there are several stubs', async () => {
  api.lookup.mockResolvedValue(summary())
  api.downloadAll.mockResolvedValue({ blob: new Blob(['%PDF-']), filename: 'AIRE-pay-stubs-2026.pdf' })
  render(<PayStubLink />)
  fireEvent.click(await screen.findByRole('button', { name: 'Download all 2 as one PDF' }))
  await waitFor(() => expect(api.downloadAll).toHaveBeenCalledWith(token))
})

it.each([
  ['expired', 'This link has expired'],
  ['revoked', 'This link was turned off'],
  ['used_up', 'This link has been used up'],
] as const)('explains a %s link without listing documents', async (state, title) => {
  api.lookup.mockResolvedValue(summary({ state, message: 'Ask the office to send a new one.', documents: [] }))
  render(<PayStubLink />)
  expect(await screen.findByRole('heading', { name: title })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /download/i })).not.toBeInTheDocument()
})

it('says when the link is incomplete, without calling the API', () => {
  window.history.replaceState(null, '', '/stubs#t=short')
  render(<PayStubLink />)
  expect(screen.getByRole('heading', { name: "This link isn't complete" })).toBeInTheDocument()
  expect(api.lookup).not.toHaveBeenCalled()
})

it('shows the reason a download was refused', async () => {
  api.lookup.mockResolvedValue(summary())
  api.download.mockRejectedValue(new PayStubError('This pay stub has been downloaded the maximum number of times.', 'download_limit', 410))
  render(<PayStubLink />)
  fireEvent.click(await screen.findByRole('button', { name: 'Download pay stub for Sat, Oct 31, 2026' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('downloaded the maximum number of times')
})

it('loads a different link opened in the same tab', async () => {
  api.lookup.mockResolvedValueOnce(summary()).mockResolvedValueOnce(summary({ first_name: 'Kai', documents: [] , state: 'revoked', message: 'x' }))
  render(<PayStubLink />)
  expect(await screen.findByRole('heading', { name: 'Hi Mindy' })).toBeInTheDocument()
  const other = 'B'.repeat(43)
  window.history.replaceState(null, '', `/stubs#t=${other}`)
  window.dispatchEvent(new HashChangeEvent('hashchange'))
  expect(await screen.findByRole('heading', { name: 'This link was turned off' })).toBeInTheDocument()
  expect(api.lookup).toHaveBeenLastCalledWith(other, expect.any(AbortSignal))
})
