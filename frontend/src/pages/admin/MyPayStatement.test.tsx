import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import MyPayStatement from './MyPayStatement'
import { MyPayError, type MyPayStatementDetail } from '../../lib/myPayApi'

const api = vi.hoisted(() => ({ statement: vi.fn(), pdf: vi.fn() }))

vi.mock('../../lib/myPayApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/myPayApi')>()
  return { ...actual, myPayApi: { ...actual.myPayApi, statement: api.statement, pdf: api.pdf } }
})
vi.mock('../../contexts/AuthContext', () => ({ useAuthContext: () => ({ isClerkEnabled: true, currentUser: { id: 7, my_pay_enabled: true } }) }))

function detail(overrides: Partial<MyPayStatementDetail> = {}): MyPayStatementDetail {
  return {
    id: '42', pay_date: '2026-11-15', check_date: '2026-11-15', period_start: '2026-10-16', period_end: '2026-10-31',
    run_purpose: 'regular', gross_pay: '1517.00', net_pay: '1372.00', total_hours: '80.00',
    payment: { method: 'paper_check', status: 'issued', issued_on: '2026-11-15', check_number_last4: '4321' },
    has_source_entries: true,
    earnings: [
      { label: 'Regular', hours: '76.00', rate: '18.50', amount: '1406.00', kind: 'regular' },
      { label: 'Overtime', hours: '4.00', rate: '27.75', amount: '111.00', kind: 'overtime' },
    ],
    taxes: [{ label: 'Federal income tax', amount: '120.00', ytd: '2400.00' }],
    deductions: [{ label: 'Retirement', amount: '25.00', ytd: '500.00' }],
    other_pay: [],
    ytd: { gross: '24690.00', net: '19753.00' },
    hours_on_check: [
      { time_entry_id: 501, work_date: '2026-09-15', category: 'Flight instruction', total_hours: '4.00', regular_hours: '4.00', overtime_hours: '0.00', source_kind: 'carryover', prior_period: true },
      { time_entry_id: 502, work_date: '2026-10-20', category: 'Flight instruction', total_hours: '8.00', regular_hours: '6.00', overtime_hours: '2.00', source_kind: 'current', prior_period: false },
      { time_entry_id: null, work_date: '2026-10-21', category: 'Ground school', total_hours: '1.00', regular_hours: '1.00', overtime_hours: '0.00', source_kind: 'current', prior_period: false },
    ],
    ...overrides,
  }
}

function renderPage(id = '42') {
  return render(
    <MemoryRouter initialEntries={[`/admin/pay/${id}`]}>
      <Routes><Route path="/admin/pay/:id" element={<MyPayStatement />} /></Routes>
    </MemoryRouter>,
  )
}

function section(name: string) {
  return screen.getByRole('heading', { level: 2, name }).closest('section') as HTMLElement
}

describe('My Pay statement detail', () => {
  beforeEach(() => {
    api.statement.mockReset()
    api.pdf.mockReset()
  })

  it('shows the full stub breakdown matching the paper stub', async () => {
    api.statement.mockResolvedValue({ worker: { employment_type: 'hourly', contractor: false }, statement: detail() })
    renderPage()

    const hero = (await screen.findByRole('heading', { level: 1, name: 'Paycheck · Nov 15, 2026' })).closest('section') as HTMLElement
    expect(within(hero).getByText('$1,372.00')).toBeVisible()
    expect(within(hero).getByText('Paid')).toBeVisible()
    expect(within(hero).getByText(/Oct 16 – Oct 31, 2026/)).toBeVisible()
    expect(api.statement).toHaveBeenCalledWith('42', expect.any(AbortSignal))

    const earnings = section('Earnings')
    expect(within(earnings).getByText('76 hrs × $18.50/hr')).toBeVisible()
    expect(within(earnings).getByText('$1,406.00')).toBeVisible()
    expect(within(earnings).getByText('4 hrs × $27.75/hr')).toBeVisible()
    expect(within(earnings).getByText('Gross pay')).toBeVisible()

    const taxes = section('Taxes')
    expect(within(taxes).getByText('Federal income tax')).toBeVisible()
    expect(within(taxes).getAllByText('$120.00')).toHaveLength(2)
    expect(within(taxes).getByText('$2,400.00')).toBeVisible()
    expect(within(section('Deductions')).getByText('$500.00')).toBeVisible()

    const ytd = section('Year to date')
    expect(within(ytd).getByText('$24,690.00')).toBeVisible()
    expect(within(ytd).getByText('$19,753.00')).toBeVisible()

    const payment = section('Payment')
    expect(within(payment).getByText('Paper check ending 4321')).toBeVisible()
  })

  it('adds other pay after taxes and deductions so the shown math reaches net pay', async () => {
    api.statement.mockResolvedValue({
      worker: { employment_type: 'hourly', contractor: false },
      statement: detail({ net_pay: '1412.00', other_pay: [{ label: 'Mileage reimbursement', amount: '40.00', ytd: '120.00' }] }),
    })
    renderPage()

    const hero = (await screen.findByRole('heading', { level: 1, name: 'Paycheck · Nov 15, 2026' })).closest('section') as HTMLElement
    // 1,517.00 - 120.00 - 25.00 + 40.00 = 1,412.00
    expect(within(hero).getByText('$1,517.00')).toBeVisible()
    expect(within(hero).getByText('−$120.00')).toBeVisible()
    expect(within(hero).getByText('−$25.00')).toBeVisible()
    expect(within(hero).getByText('+$40.00')).toBeVisible()
    expect(within(hero).getByText('$1,412.00')).toBeVisible()
    const other = section('Other pay')
    expect(within(other).getByText('Mileage reimbursement')).toBeVisible()
    expect(within(other).getByText('$120.00')).toBeVisible()
    expect(within(other).getByText('Total other pay')).toBeVisible()
  })

  it('hides the other pay section when the stub has none', async () => {
    api.statement.mockResolvedValue({ worker: { employment_type: 'hourly', contractor: false }, statement: detail() })
    renderPage()
    await screen.findByRole('heading', { level: 1, name: 'Paycheck · Nov 15, 2026' })
    expect(screen.queryByRole('heading', { name: 'Other pay' })).not.toBeInTheDocument()
    expect(screen.queryByText(/^\+\$/)).not.toBeInTheDocument()
  })

  it('keeps the work-date note in an earning label on its own line', async () => {
    api.statement.mockResolvedValue({
      worker: { employment_type: 'hourly', contractor: false },
      statement: detail({ earnings: [{ label: 'Prior-period hours worked Sep 15, 2026\nAdmin Duties', hours: '4.25', rate: '10.00', amount: '42.50', kind: 'regular' }] }),
    })
    renderPage()

    const label = await within(await screen.findByRole('heading', { level: 2, name: 'Earnings' }).then((h) => h.closest('section') as HTMLElement))
      .findByText((_, element) => element?.tagName === 'P' && element.textContent === 'Prior-period hours worked Sep 15, 2026\nAdmin Duties')
    expect(label).toHaveClass('whitespace-pre-line', 'break-words')
  })

  it('explains an older check with no recorded delivery instead of calling it Processing', async () => {
    api.statement.mockResolvedValue({
      worker: { employment_type: 'hourly', contractor: false },
      statement: detail({ pay_date: '2026-04-30', payment: { method: 'paper_check', status: 'pending', issued_on: null, check_number_last4: '3056' } }),
    })
    renderPage()

    await screen.findByRole('heading', { level: 1, name: 'Paycheck · Apr 30, 2026' })
    expect(screen.queryByText('Processing')).not.toBeInTheDocument()
    const payment = section('Payment')
    expect(within(payment).getByText('Not recorded yet')).toBeVisible()
    expect(within(payment).getByText(/hasn't recorded this check as delivered/)).toBeVisible()
  })

  it('lists the hours on this check, labels earlier hours and links own entries to My Time', async () => {
    api.statement.mockResolvedValue({ worker: { employment_type: 'hourly', contractor: false }, statement: detail() })
    renderPage()

    const hours = (await screen.findByRole('heading', { level: 2, name: 'Hours on this check' })).closest('section') as HTMLElement
    expect(within(hours).getByText('Worked Sep 15 · paid on this check')).toBeVisible()
    expect(within(hours).getByText(/6 hrs regular · 2 hrs overtime/)).toBeVisible()
    const link = within(hours).getByRole('link', { name: /Open Tue, Sep 15 time entry/ })
    expect(link.getAttribute('href')).toBe('/admin/time?date=2026-09-15&view=day&entry_id=501&return_to=%2Fadmin%2Fpay%2F42')
    expect(within(hours).getAllByRole('link')).toHaveLength(2)
    expect(within(hours).getByText('Ground school')).toBeVisible()
  })

  it('uses flat-rate contractor wording with no taxes and no overtime language', async () => {
    api.statement.mockResolvedValue({
      worker: { employment_type: 'contractor', contractor: true },
      statement: detail({
        earnings: [
          { label: 'Contract hours', hours: '80.00', rate: '25.00', amount: '2000.00', kind: 'regular' },
          { label: 'Contract hours', hours: '2.00', rate: '37.50', amount: '75.00', kind: 'regular', note: 'Paid at 1.5× your contract rate' },
        ],
        taxes: [],
        deductions: [],
        other_pay: [{ label: 'Payroll May 1-15', amount: '0.00', ytd: '323.75' }],
        gross_pay: '2075.00',
        net_pay: '2075.00',
        hours_on_check: [
          { time_entry_id: 502, work_date: '2026-10-20', category: 'Flight instruction', total_hours: '10.00', source_kind: 'current', prior_period: false },
        ],
      }),
    })
    renderPage()

    expect(await screen.findByRole('heading', { level: 1, name: 'Payment statement · Nov 15, 2026' })).toBeVisible()
    expect(screen.queryByRole('heading', { name: 'Taxes' })).not.toBeInTheDocument()
    expect(screen.getByText('80 hrs × $25.00/hr contract rate')).toBeVisible()
    // An older row paid above the contract rate shows its real rate and says why.
    expect(screen.getByText('2 hrs × $37.50/hr')).toBeVisible()
    expect(screen.getByText('Paid at 1.5× your contract rate')).toBeVisible()
    expect(within(section('Other pay')).getByText('$323.75')).toBeVisible()
    expect(screen.getByText('Total payment')).toBeVisible()
    expect(document.body.textContent).not.toMatch(/overtime|\bOT\b|tax/i)
  })

  it('downloads the official PDF stub', async () => {
    api.statement.mockResolvedValue({ worker: { employment_type: 'hourly', contractor: false }, statement: detail() })
    api.pdf.mockResolvedValue({ blob: new Blob(['%PDF-1.7'], { type: 'application/pdf' }), filename: 'AIRE-pay-statement-2026-11-15.pdf' })
    const createObjectURL = vi.fn(() => 'blob:stub')
    const revokeObjectURL = vi.fn()
    Object.assign(URL, { createObjectURL, revokeObjectURL })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: 'Download PDF stub' }))
    await waitFor(() => expect(click).toHaveBeenCalled())
    expect(api.pdf).toHaveBeenCalledWith('42')
    expect(createObjectURL).toHaveBeenCalled()
    click.mockRestore()
  })

  it('shows a download error without losing the statement', async () => {
    api.statement.mockResolvedValue({ worker: { employment_type: 'hourly', contractor: false }, statement: detail() })
    api.pdf.mockRejectedValue(new MyPayError('Pay history is temporarily unavailable. Please try again in a few minutes.', 'my_pay_unavailable', 503))
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: 'Download PDF stub' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('temporarily unavailable')
    expect(screen.getByText('$1,372.00')).toBeVisible()
  })

  it("shows not found for a paycheck that isn't the worker's", async () => {
    api.statement.mockRejectedValue(new MyPayError("We couldn't find that paycheck.", 'statement_not_found', 404))
    renderPage('99')
    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText('Paycheck not found')).toBeVisible()
    expect(within(alert).queryByRole('button')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'All pay' })).toHaveAttribute('href', '/admin/pay')
  })

  it('retries after Cornerstone is unavailable', async () => {
    api.statement.mockRejectedValueOnce(new MyPayError('Pay history is temporarily unavailable. Please try again in a few minutes.', 'my_pay_unavailable', 503))
    api.statement.mockResolvedValueOnce({ worker: { employment_type: 'hourly', contractor: false }, statement: detail() })
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('$1,372.00')).toBeVisible()
    expect(api.statement).toHaveBeenCalledTimes(2)
  })
})
