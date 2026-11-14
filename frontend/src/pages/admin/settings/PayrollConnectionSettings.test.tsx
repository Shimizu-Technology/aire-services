import '@testing-library/jest-dom'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const connection = vi.hoisted(() => vi.fn())
vi.mock('../../../lib/api/settings', () => ({ settingsApi: { connection } }))

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
  await screen.findByText('Connected')
}

describe('PayrollConnectionSettings reconnect', () => {
  beforeEach(() => {
    vi.resetModules()
    connection.mockResolvedValue({ data })
  })
  afterEach(() => {
    cleanup()
    vi.unstubAllEnvs()
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
