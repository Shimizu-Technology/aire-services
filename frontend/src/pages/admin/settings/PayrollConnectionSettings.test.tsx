import '@testing-library/jest-dom'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { connection } from '../../../test/fixtures/today'
import { payrollConnectionCopy } from '../../../lib/payrollConnection'

const connectionRequest = vi.hoisted(() => vi.fn())
vi.mock('../../../lib/api/settings', () => ({ settingsApi: { connection: connectionRequest } }))

const data = {
  state: 'connected',
  mode: 'connected',
  last_publication: null,
  last_delivery: null,
  account_link: null,
}

async function renderPage() {
  const { default: PayrollConnectionSettings } = await import('./PayrollConnectionSettings')
  render(<MemoryRouter><PayrollConnectionSettings /></MemoryRouter>)
  await screen.findByText('Time tracking account')
}

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

describe('PayrollConnectionSettings reconnect', () => {
  beforeEach(() => {
    vi.resetModules()
    connectionRequest.mockResolvedValue({ data })
  })

  it('no longer links to the token-less /admin/payroll-link page', async () => {
    vi.stubEnv('VITE_CORNERSTONE_PAYROLL_URL', 'https://payroll.example.com')
    await renderPage()
    expect(screen.queryByRole('link', { name: 'Reconnect' })).toBeNull()
    document.querySelectorAll('a').forEach((a) => expect(a.getAttribute('href')).not.toBe('/admin/payroll-link'))
  })

  it('sends the person to Cornerstone Payroll\'s connection screen in a new tab', async () => {
    vi.stubEnv('VITE_CORNERSTONE_PAYROLL_URL', 'https://payroll.example.com/some/path')
    await renderPage()
    const link = screen.getByRole('link', { name: /Open Cornerstone Payroll to reconnect/ })
    expect(link).toHaveAttribute('href', 'https://payroll.example.com/app/aire-account-connection')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'))
    expect(screen.getByText('Time tracking account')).toBeInTheDocument()
    expect(screen.getByText('Connect my time tracking account')).toBeInTheDocument()
  })

  it('explains the path but shows no dead link when Cornerstone\'s address is unknown', async () => {
    vi.stubEnv('VITE_CORNERSTONE_PAYROLL_URL', '')
    await renderPage()
    expect(screen.queryByRole('link', { name: /Cornerstone Payroll to reconnect/ })).toBeNull()
    expect(screen.getByText(/started from Cornerstone Payroll/)).toBeInTheDocument()
  })

  it('refuses a non-https address', async () => {
    vi.stubEnv('VITE_CORNERSTONE_PAYROLL_URL', 'http://payroll.example.com')
    await renderPage()
    expect(screen.queryByRole('link', { name: /Cornerstone Payroll to reconnect/ })).toBeNull()
  })
})

it.each(['paused', 'delivery_problem', 'connected'] as const)('uses the same %s headline as Today', async state => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-11T19:41:00+10:00'))
  const fixture = connection({ state, last_delivery: null, account_link: null })
  connectionRequest.mockResolvedValue({ data: { ...fixture, account_link: null } })
  const { default: PayrollConnectionSettings } = await import('./PayrollConnectionSettings')
  render(<MemoryRouter><PayrollConnectionSettings /></MemoryRouter>)
  expect(await screen.findByText(payrollConnectionCopy(fixture).title, { selector: '.font-semibold' })).toBeInTheDocument()
  expect(screen.getByText(payrollConnectionCopy(fixture).detail)).toBeInTheDocument()
  expect(screen.getByText(/Last heard from: Nov 11, 2026, 7:05 PM/)).toBeInTheDocument()
})
