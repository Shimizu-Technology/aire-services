import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { payStubsApi, type PayStubRequest } from '../../lib/payStubsApi'
import { ToastProvider } from '../ui'
import StubRequestsList from './StubRequestsList'
vi.mock('../../lib/payStubsApi', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../lib/payStubsApi')>()
  return {
    ...original,
    payStubsApi: { ...original.payStubsApi, statements: vi.fn(), send: vi.fn() },
  }
})
afterEach(() => {
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
})
it('keeps a non-default statement selection mounted across offline/online and blocks sending offline', async () => {
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
  const request: PayStubRequest = {
    id: 1,
    links: [],
    status: 'open',
    source: 'kiosk',
    scope: 'year',
    statement_id: null,
    pay_date: null,
    year: 2026,
    worker: {
      id: 1,
      name: 'Marcus Quinata',
      first_name: 'Marcus',
      role: 'employee',
      on_file_email: 'marcus@aire.test',
    },
    recipient_kind: 'on_file',
    recipient_email: 'marcus@aire.test',
    can_send: true,
    requested_at: '2026-11-14T00:00:00Z',
    resolved_at: null,
    resolved_by: null,
    resolution_note: null,
  }
  vi.mocked(payStubsApi.statements).mockResolvedValue({
    statements: [
      {
        id: 'a',
        pay_date: '2026-11-10',
        period_start: '2026-10-16',
        period_end: '2026-10-31',
        voided: false,
      },
      {
        id: 'b',
        pay_date: '2026-10-25',
        period_start: '2026-10-01',
        period_end: '2026-10-15',
        voided: false,
      },
    ],
  })
  render(
    <ToastProvider>
      <StubRequestsList requests={[request]} canChooseRecipient onChanged={vi.fn()} />
    </ToastProvider>,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Send pay stub to Marcus Quinata' }))
  await waitFor(() => expect(screen.getAllByRole('checkbox')).toHaveLength(2))
  fireEvent.click(screen.getAllByRole('checkbox')[0])
  expect(screen.getAllByRole('checkbox')[0]).not.toBeChecked()
  act(() => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true })
    window.dispatchEvent(new Event('offline'))
  })
  expect(screen.getByRole('dialog')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Send secure link' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Send secure link' }))
  expect(payStubsApi.send).not.toHaveBeenCalled()
  act(() => {
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
    window.dispatchEvent(new Event('online'))
  })
  expect(screen.getAllByRole('checkbox')[0]).not.toBeChecked()
  expect(screen.getAllByRole('checkbox')[1]).toBeChecked()
  expect(screen.getByRole('button', { name: 'Send secure link' })).toBeEnabled()
  expect(payStubsApi.statements).toHaveBeenCalledTimes(1)
})
