import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import MyPay from './MyPay'
import { MyPayError, type MyPayStatementSummary } from '../../lib/myPayApi'

const listMock = vi.hoisted(() => vi.fn())
const auth = vi.hoisted(() => ({ value: { isClerkEnabled: true, currentUser: { id: 7, my_pay_enabled: true } as { id: number; my_pay_enabled: boolean } | null } }))

vi.mock('../../lib/myPayApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/myPayApi')>()
  return { ...actual, myPayApi: { ...actual.myPayApi, list: listMock } }
})
vi.mock('../../contexts/AuthContext', () => ({ useAuthContext: () => auth.value }))

function statement(overrides: Partial<MyPayStatementSummary> = {}): MyPayStatementSummary {
  return {
    id: '42', pay_date: '2026-11-15', check_date: '2026-11-15', period_start: '2026-10-16', period_end: '2026-10-31',
    run_purpose: 'regular', gross_pay: '1234.56', net_pay: '987.65', total_hours: '80.00',
    payment: { method: 'paper_check', status: 'prepared', issued_on: null, check_number_last4: null },
    has_source_entries: true,
    ...overrides,
  }
}

function renderPage() {
  return render(<MemoryRouter><MyPay /></MemoryRouter>)
}

describe('My Pay list', () => {
  beforeEach(() => {
    listMock.mockReset()
    auth.value = { isClerkEnabled: true, currentUser: { id: 7, my_pay_enabled: true } }
  })

  it('lists each paycheck newest first with pay date, net, gross, period, hours and plain status', async () => {
    listMock.mockResolvedValue({
      worker: { employment_type: 'hourly', contractor: false },
      statements: [
        statement(),
        statement({ id: '41', pay_date: '2026-10-31', period_start: '2026-10-01', period_end: '2026-10-15', net_pay: '900.00', payment: { method: 'paper_check', status: 'issued', issued_on: '2026-10-31', check_number_last4: '1234' } }),
        statement({ id: '30', pay_date: '2025-12-31', period_start: '2025-12-16', period_end: '2025-12-31', net_pay: '10.00', run_purpose: 'supplemental', payment: { method: 'paper_check', status: 'voided', issued_on: null, check_number_last4: null } }),
      ],
    })
    renderPage()

    const links = await screen.findAllByRole('link', { name: /Paycheck for/ })
    expect(links.map((link) => link.getAttribute('href'))).toEqual(['/admin/pay/42', '/admin/pay/41', '/admin/pay/30'])
    const latest = links[0]
    expect(within(latest).getByText('Sun, Nov 15, 2026')).toBeVisible()
    expect(within(latest).getByText('$987.65')).toBeVisible()
    expect(within(latest).getByText('$1,234.56')).toBeVisible()
    expect(within(latest).getByText('Oct 16 – Oct 31, 2026')).toBeVisible()
    expect(within(latest).getByText('80 hrs')).toBeVisible()
    expect(within(latest).getByText('Check ready')).toBeVisible()
    expect(within(links[1]).getByText('Paid')).toBeVisible()
    expect(within(links[2]).getByText('Voided')).toBeVisible()
    expect(within(links[2]).getByText('Supplemental payroll')).toBeVisible()
    expect(screen.getByRole('heading', { level: 2, name: '2026' })).toBeVisible()
    expect(screen.getByRole('heading', { level: 2, name: '2025' })).toBeVisible()
    expect(listMock).toHaveBeenCalledTimes(1)
    expect(listMock.mock.calls[0]).toHaveLength(1)
  })

  it('says Processing only for an upcoming check, never for an old one payroll has no delivery record for', async () => {
    const pending = { method: 'paper_check' as const, status: 'pending' as const, issued_on: null, check_number_last4: null }
    listMock.mockResolvedValue({
      worker: { employment_type: 'hourly', contractor: false },
      statements: [
        statement({ id: '50', pay_date: '2099-01-15', payment: pending }),
        statement({ id: '20', pay_date: '2026-04-30', payment: pending }),
      ],
    })
    renderPage()

    const links = await screen.findAllByRole('link', { name: /Paycheck for/ })
    expect(within(links[0]).getByText('Processing')).toBeVisible()
    expect(within(links[1]).queryByText('Processing')).not.toBeInTheDocument()
    expect(links[1]).toHaveAccessibleName('Paycheck for Thu, Apr 30, 2026, net $987.65')
  })

  it('shows an empty state with a path to My Time', async () => {
    listMock.mockResolvedValue({ worker: { employment_type: 'hourly', contractor: false }, statements: [] })
    renderPage()
    expect(await screen.findByRole('heading', { name: 'No paychecks yet' })).toBeVisible()
    expect(screen.getByRole('link', { name: 'Go to My Time' })).toHaveAttribute('href', '/admin/time')
  })

  it('uses payment wording for contractors', async () => {
    listMock.mockResolvedValue({ worker: { employment_type: 'contractor', contractor: true }, statements: [statement()] })
    renderPage()
    const link = await screen.findByRole('link', { name: /Payment for/ })
    expect(within(link).getByText('Payment')).toBeVisible()
    expect(screen.getByText(/payment statement from AIRE Services/)).toBeVisible()
    expect(document.body.textContent).not.toMatch(/overtime|paycheck/i)
  })

  it('shows a friendly unavailable state and retries', async () => {
    listMock.mockRejectedValueOnce(new MyPayError('Pay history is temporarily unavailable. Please try again in a few minutes.', 'my_pay_unavailable', 503))
    listMock.mockResolvedValueOnce({ worker: { employment_type: 'hourly', contractor: false }, statements: [statement()] })
    renderPage()

    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText('Pay history is temporarily unavailable')).toBeVisible()
    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('link', { name: /Paycheck for/ })).toBeVisible()
    expect(listMock).toHaveBeenCalledTimes(2)
  })

  it('explains a missing payroll link without offering a pointless retry', async () => {
    listMock.mockRejectedValue(new MyPayError("Your AIRE account isn't connected to payroll yet. Ask an AIRE administrator to connect it.", 'payroll_not_linked', 404))
    renderPage()
    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText('Payroll not connected yet')).toBeVisible()
    expect(within(alert).queryByRole('button')).not.toBeInTheDocument()
  })

  it('stays hidden and makes no request when My Pay is not enabled', async () => {
    auth.value = { isClerkEnabled: true, currentUser: { id: 7, my_pay_enabled: false } }
    renderPage()
    expect(screen.getByText(/My Pay isn.t available for your account yet/)).toBeVisible()
    await waitFor(() => expect(listMock).not.toHaveBeenCalled())
  })

  it('shows a loading skeleton while the signed-in user is still resolving', () => {
    auth.value = { isClerkEnabled: true, currentUser: null }
    renderPage()
    expect(screen.getByText('Loading your pay history…')).toBeInTheDocument()
    expect(listMock).not.toHaveBeenCalled()
  })
})
