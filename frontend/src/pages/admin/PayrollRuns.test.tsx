import '@testing-library/jest-dom'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockMatchMedia } from '../../test/matchMedia'
import { NOW, attention, connection, cutoff, lockControl } from '../../test/fixtures/today'
import { carried, lockedBatch, paidPeriod, periodSummary, periodsIndex, preview } from '../../test/fixtures/payPeriod'
import type { PayrollPeriodSummary } from '../../lib/api/payrollPeriod'
import PayrollRuns from './PayrollRuns'

const mocks = vi.hoisted(() => ({
  periods: vi.fn(),
  period: vi.fn(),
  attention: vi.fn(),
  connection: vi.fn(),
  getPayrollCutoff: vi.fn(),
  previewPayrollBatch: vi.fn(),
  getPayrollBatch: vi.fn(),
  getPayrollBatches: vi.fn(),
  getPayrollCarryovers: vi.fn(),
  downloadHoursReport: vi.fn(),
  downloadPayrollBatch: vi.fn(),
  finalizePayrollBatch: vi.fn(),
  getPendingApprovals: vi.fn(),
}))
vi.mock('../../lib/api', () => ({
  api: {
    getPayrollCutoff: mocks.getPayrollCutoff,
    previewPayrollBatch: mocks.previewPayrollBatch,
    getPayrollBatch: mocks.getPayrollBatch,
    getPayrollBatches: mocks.getPayrollBatches,
    getPayrollCarryovers: mocks.getPayrollCarryovers,
    downloadHoursReport: mocks.downloadHoursReport,
    downloadPayrollBatch: mocks.downloadPayrollBatch,
    finalizePayrollBatch: mocks.finalizePayrollBatch,
    getPendingApprovals: mocks.getPendingApprovals,
  },
}))
vi.mock('../../lib/api/attention', () => ({ attentionApi: { attention: mocks.attention, connection: mocks.connection } }))
vi.mock('../../lib/api/payrollPeriod', () => ({ payrollPeriodApi: { periods: mocks.periods, period: mocks.period } }))
vi.mock('../../contexts/AuthContext', () => ({ useAuthContext: () => ({ userRole: 'admin', isClerkEnabled: true }) }))

let restoreMatchMedia: () => void

function Where() {
  const location = useLocation()
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>
}

async function open(path = '/admin/payroll') {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/admin/payroll" element={<PayrollRuns />} />
        <Route path="/admin/payroll/periods/:start" element={<PayrollRuns />} />
        <Route path="*" element={<p>Somewhere else</p>} />
      </Routes>
      <Where />
    </MemoryRouter>,
  )
  await settle()
}

const settle = (ms = 0) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })

/** Answers the show endpoint from a list of periods. */
function publish(...periods: PayrollPeriodSummary[]) {
  mocks.period.mockImplementation(async (start: string) => {
    const found = periods.find(period => period.start_date === start)
    return found
      ? { data: { period: found, previous_start_date: null, next_start_date: null, connected_payroll: { mode: 'enabled', enabled: true, message: null } } }
      : { error: 'No pay period is published for that date', status: 404, code: 'not_published' }
  })
}

/** Pending approvals on the period's dates: 31 shifts, one with 6h overtime (Ethan). */
function pendingApprovals(params: { approval_type?: string }) {
  if (params.approval_type === 'overtime') {
    return { data: { count: 1, pending_entries: [{ id: 905, user: { full_name: 'Ethan Cruz', display_name: 'Ethan' }, pending_overtime_hours: 6 }],
      summary: { entry_count: 1, total_hours: 11.5 } } }
  }
  return { data: { count: 31, pending_entries: [], summary: { entry_count: 31, total_hours: 276.06 } } }
}

const checklist = () => within(screen.getByRole('region', { name: /Before it locks/ }))
const steps = () => within(screen.getByRole('list', { name: 'Hand-off to Cornerstone Payroll' }))

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date'] })
  vi.setSystemTime(new Date(NOW))
  restoreMatchMedia = mockMatchMedia({ width: 1280 })
  for (const mock of Object.values(mocks)) mock.mockReset()
  mocks.periods.mockResolvedValue({ data: periodsIndex() })
  publish(periodSummary(), paidPeriod())
  mocks.attention.mockResolvedValue({ data: attention() })
  mocks.connection.mockResolvedValue({ data: connection() })
  mocks.getPayrollCutoff.mockResolvedValue({ data: cutoff() })
  mocks.previewPayrollBatch.mockResolvedValue({ data: preview() })
  mocks.getPayrollBatch.mockResolvedValue({ data: lockedBatch() })
  mocks.getPendingApprovals.mockImplementation(async (params: { approval_type?: string }) => pendingApprovals(params))
  mocks.getPayrollBatches.mockResolvedValue({ data: { payroll_batches: [], total_count: 0, truncated: false, connected_payroll: { mode: 'enabled', enabled: true, message: null } } })
  mocks.getPayrollCarryovers.mockResolvedValue({ data: { items: [], summary: { awaiting_approval_count: 0, ready_for_next_batch_count: 0, in_payroll_count: 0, not_payable_count: 0 }, truncated: false } })
})

afterEach(() => {
  vi.useRealTimers()
  restoreMatchMedia()
})

describe('pay period page: open period', () => {
  it('heads the page with the period, the lock, payday and the connection', async () => {
    await open()
    expect(screen.getByRole('heading', { level: 1, name: 'Nov 1–15 pay period' })).toBeInTheDocument()
    expect(screen.getByText(/pays Wed, Nov 25/).closest('p')).toHaveTextContent('Locks Wed, Nov 18, 5:00 PM · pays Wed, Nov 25')
    const status = within(screen.getByRole('list', { name: 'Status' }))
    expect(status.getByText('Open · locks in 7 days')).toBeInTheDocument()
    expect(status.getByText('Connected to Cornerstone Payroll')).toBeInTheDocument()
    expect(document.title).toBe('Nov 1–15 pay period | AIRE Ops')
    // The #170 lock control, unchanged, with its own buttons.
    expect(screen.getByRole('button', { name: 'Lock now' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Change lock time' })).toBeInTheDocument()
    expect(mocks.period).toHaveBeenCalledWith('2026-11-01')
    expect(mocks.previewPayrollBatch).toHaveBeenCalledWith('2026-11-01', '2026-11-15')
    expect(mocks.getPendingApprovals).toHaveBeenCalledWith({ start_date: '2026-11-01', end_date: '2026-11-15', per_page: 1 })
    expect(mocks.getPendingApprovals).toHaveBeenCalledWith({ start_date: '2026-11-01', end_date: '2026-11-15', approval_type: 'overtime', per_page: 500 })
  })

  it('links each open checklist item to its filtered view', async () => {
    // Jun's carried-in Oct 30 line has no work category: it blocks the lock.
    const base = preview()
    mocks.previewPayrollBatch.mockResolvedValue({ data: preview({
      employees: base.employees.map(employee => employee.display_name === 'Jun Santos' ? { ...employee, adjustments: employee.adjustments.map(line => ({ ...line, category: null })) } : employee),
      issues: { ...base.issues, missing_category_count: 1 },
    }) })
    await open()
    const links = checklist().getAllByRole('link').map(link => [link.textContent, link.getAttribute('href')])
    expect(links).toEqual([
      ['Review: 31 shifts waiting for approval', '/admin/approvals?start_date=2026-11-01&end_date=2026-11-15'],
      ['Fix: 1 person still clocked in from an earlier day', '/admin/timecards?entry_id=812&date=2026-11-10&user_id=7'],
      ['Review: 6h overtime waiting', '/admin/approvals?start_date=2026-11-01&end_date=2026-11-15&approval_type=overtime'],
      ['Fix: 1 shift has no work category', '/admin/timecards?entry_id=640'],
    ])
    expect(checklist().getByText('Note:').closest('li')).toHaveTextContent('1 shift approved after an earlier lock goes into this payroll')
    expect(screen.getByRole('heading', { name: /Before it locks · 4 things to do/ })).toBeInTheDocument()
  })

  it('opens the filtered view when a checklist action is followed', async () => {
    await open()
    fireEvent.click(checklist().getByRole('link', { name: /Review.*31 shifts/ }))
    expect(screen.getByTestId('location')).toHaveTextContent('/admin/approvals?start_date=2026-11-01&end_date=2026-11-15')
  })

  it('shows the hand-off at Open and hides carried hours on an open period', async () => {
    await open()
    expect(steps().getByText('Open').closest('li')).toHaveAttribute('aria-current', 'step')
    expect(screen.queryByRole('region', { name: /Hours carried to a later period/ })).not.toBeInTheDocument()
    expect(mocks.getPayrollCarryovers).not.toHaveBeenCalled()
    expect(screen.getByText('Available after payday (Wed, Nov 25).')).toBeInTheDocument()
  })

  it('lists what goes to payroll by person, collapsed, with flags and totals', async () => {
    await open()
    const table = screen.getByRole('table', { name: 'What goes to payroll if it locked now' })
    const caleb = within(table).getByRole('rowheader', { name: /Caleb Perez/ }).closest('tr')!
    expect(caleb).toHaveTextContent('Caleb PerezStill clocked in43.2h0h9.1h')
    expect(within(table).getByRole('rowheader', { name: /Ethan Cruz/ })).toHaveTextContent('6h OT waiting')
    expect(within(table).getByRole('rowheader', { name: 'Total' }).closest('tr')).toHaveTextContent('Total92.1h0h19.1h')
    expect(within(table).queryByText(/Mon, Nov 3/)).not.toBeInTheDocument()
    fireEvent.click(within(table).getByRole('button', { name: "Show Caleb Perez's days" }))
    expect(within(table).getByText(/Tue, Nov 3 · Ground Operations/)).toBeInTheDocument()
    expect(within(table).getByText(/Tue, Nov 10 · Still clocked in/)).toBeInTheDocument()
  })

  // Codex finding 4: a failed refresh never leaves an earlier "all clear" standing unqualified.
  it('qualifies an all-clear checklist and the table when a refresh fails', async () => {
    mocks.attention.mockResolvedValue({ data: attention({ items: [] }) })
    mocks.getPendingApprovals.mockResolvedValue({ data: { count: 0, pending_entries: [], summary: { entry_count: 0, total_hours: 0 } } })
    mocks.previewPayrollBatch.mockResolvedValue({ data: preview({ employees: preview().employees.slice(0, 1), exclusions: [] }) })
    await open()
    expect(screen.getByRole('heading', { name: /Before it locks · all clear/ })).toBeInTheDocument()
    mocks.previewPayrollBatch.mockResolvedValue({ error: 'Server error' })
    mocks.getPendingApprovals.mockResolvedValue({ error: 'Server error' })
    await settle(6_000)
    act(() => { window.dispatchEvent(new Event('focus')) })
    await settle()
    expect(screen.queryByText(/all clear/)).not.toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: /Before it locks/ })).getByRole('status')).toHaveTextContent("Couldn't refresh the checklist · Last updated 7:41 PM. It may not be ready to lock.")
    expect(within(screen.getByRole('region', { name: /What goes to payroll/ })).getByRole('status')).toHaveTextContent("Couldn't refresh what goes to payroll. Last updated 7:41 PM.")
  })

  it('becomes a list of people on a phone', async () => {
    restoreMatchMedia()
    restoreMatchMedia = mockMatchMedia({ width: 390 })
    await open()
    const list = screen.getByRole('list', { name: 'What goes to payroll if it locked now' })
    expect(within(list).getByRole('button', { name: /Caleb Perez/ })).toHaveTextContent('Caleb Perez43.2h approved9.1h waitingStill clocked in')
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('downloads the PDF and payroll CSV through the existing report exports', async () => {
    const createObjectURL = vi.fn(() => 'blob:report')
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
    mocks.downloadHoursReport.mockResolvedValue({ blob: new Blob(['%PDF']), filename: 'AIRE_Hours.pdf' })
    await open()
    // Codex finding 8: labelled as the live report, not as what goes to payroll.
    expect(screen.getByText(/The live hours report lists the approved shifts dated in this period. It can differ from this table/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /What was sent to payroll/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Hours report (live) PDF' }))
    await settle()
    fireEvent.click(screen.getByRole('button', { name: 'Hours report (live) CSV' }))
    await settle()
    const params = { start_date: '2026-11-01', end_date: '2026-11-15', status: 'all', approval_status: 'approved_or_standard' }
    expect(mocks.downloadHoursReport.mock.calls).toEqual([['pdf', params, false], ['summary_csv', params, false]])
    expect(createObjectURL).toHaveBeenCalledTimes(2)
  })

  it('asks before downloading a draft report', async () => {
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:report') })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
    mocks.downloadHoursReport
      .mockResolvedValueOnce({ error: 'Needs acknowledgement', code: 'draft_acknowledgement_required' })
      .mockResolvedValueOnce({ blob: new Blob(['%PDF']), filename: 'DRAFT.pdf' })
    await open()
    fireEvent.click(screen.getByRole('button', { name: 'Hours report (live) PDF' }))
    await settle()
    fireEvent.click(screen.getByRole('button', { name: 'Download draft' }))
    await settle()
    expect(mocks.downloadHoursReport).toHaveBeenLastCalledWith('pdf', expect.any(Object), true)
  })
})

describe('pay period page: lock states', () => {
  it('leaves a refused lock-time change to the #170 lock control, without a banner', async () => {
    const change = { state: 'rejected' as const, action: 'lock_now' as const, cutoff_at: null, requested_by_name: 'Chels', requested_at: NOW, error: 'Cornerstone refused the change' }
    publish(periodSummary({ lock_change: change }), paidPeriod())
    mocks.getPayrollCutoff.mockResolvedValue({ data: cutoff(lockControl({ pending_change: change })) })
    await open()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    // Said once, in the lock control's own note.
    const [reason] = screen.getAllByText(/AIRE couldn’t apply Lock now: Cornerstone refused the change/)
    expect(screen.getAllByText(/AIRE couldn’t apply Lock now/)).toHaveLength(1)
    expect(reason.closest('section')).toHaveTextContent('Next AIRE lock')
  })

  it('says a failed lock is retried', async () => {
    publish(periodSummary({ status: 'failed', cutoff_state: 'attention_required' }), paidPeriod())
    mocks.getPayrollCutoff.mockResolvedValue({ data: cutoff(lockControl({ status: 'failed' })) })
    await open()
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('AIRE couldn’t lock the Nov 1–15 hours. It tries again on its own.')
    expect(within(screen.getByRole('list', { name: 'Status' })).getByText('Lock failed')).toBeInTheDocument()
    const before = mocks.period.mock.calls.length
    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }))
    await settle()
    expect(mocks.period.mock.calls.length).toBeGreaterThan(before)
  })

  it('says a failed lock waits for the connection while it is paused', async () => {
    const paused = { mode: 'paused', enabled: false, message: 'Paused' } as const
    publish(periodSummary({ status: 'failed', cutoff_state: 'attention_required' }), paidPeriod())
    mocks.periods.mockResolvedValue({ data: { ...periodsIndex(), connected_payroll: paused } })
    mocks.connection.mockResolvedValue({ data: connection({ state: 'paused', mode: 'paused', enabled: false }) })
    await open()
    expect(screen.getByText(/AIRE couldn’t lock the Nov 1–15 hours/)).toHaveTextContent('It tries again once the payroll connection is resumed.')
  })

  it('waits for Cornerstone Payroll after the lock, without the checklist', async () => {
    const locked = periodSummary({ status: 'finalized', handoff_state: 'locked', label: 'Locked for payroll', locked_at: '2026-11-11T17:00:04+10:00', payroll_batch_id: 'AIRE-PAY-NOV', hours_source: 'locked' })
    mocks.periods.mockResolvedValue({ data: periodsIndex([locked, paidPeriod()], '2026-11-01') })
    publish(locked, paidPeriod())
    const frozen = lockedBatch()
    const heldOvertime = { ...frozen.payload.exclusions[0], source_time_entry_id: '602', source_user_id: '7', display_name: 'Caleb Perez', reason: 'pending_overtime', original_work_date: '2026-10-21', held_total_hours: 12, held_regular_hours: 8, held_overtime_hours: 4 }
    mocks.getPayrollBatch.mockResolvedValue({ data: { ...frozen, id: 'AIRE-PAY-NOV', payload: { ...frozen.payload, exclusions: [...frozen.payload.exclusions, heldOvertime] } } })
    mocks.getPayrollCarryovers.mockResolvedValue({ data: { items: [carried({ original_work_date: '2026-11-04' })], summary: { awaiting_approval_count: 0, ready_for_next_batch_count: 1, in_payroll_count: 0, not_payable_count: 0 }, truncated: false } })
    await open()
    expect(steps().getByText('Locked for payroll').closest('li')).toHaveAttribute('aria-current', 'step')
    expect(screen.getByText('Waiting for Cornerstone Payroll to confirm it received the hours. This usually takes under a minute.')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: /Before it locks/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Lock now' })).not.toBeInTheDocument()
    expect(mocks.previewPayrollBatch).not.toHaveBeenCalled()
    expect(mocks.getPayrollBatch).toHaveBeenCalledWith('AIRE-PAY-NOV')
    const sent = screen.getByRole('table', { name: 'What AIRE sent to payroll at the lock' })
    // Only people whose hours went; held-back shifts aren't listed at 0h.
    expect(within(sent).getAllByRole('rowheader').map(cell => cell.textContent)).toEqual(['Caleb Perez4h OT held back at the lock', 'Total'])
    // Overtime held back at the lock may be approved since: it isn't called waiting.
    expect(within(sent).queryByText(/OT waiting/)).not.toBeInTheDocument()
    expect(within(sent).getByText('4h OT held back at the lock')).toBeInTheDocument()
    expect(screen.getByText(/Locked Nov 11/).closest('p')).toHaveTextContent('Locked Nov 11 · pays Wed, Nov 25')
    const carriedList = within(screen.getByRole('region', { name: /Hours carried to a later period/ }))
    expect(carriedList.getByText('Jun Santos').closest('li')).toHaveTextContent('Jun Santos · Wed, Nov 4 · 8.9h→ Next payroll')
  })

  it('downloads the locked hours CSV for a locked period', async () => {
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:csv') })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
    mocks.downloadPayrollBatch.mockResolvedValue({ blob: new Blob(['csv']), filename: 'AIRE-PAY-20261031-OCT.csv' })
    await open('/admin/payroll/periods/2026-10-16')
    // Codex finding 8: the frozen batch is the primary "what was sent" download; the live report is labelled apart.
    const buttons = within(screen.getByRole('region', { name: /What went to payroll/ })).getAllByRole('button').map(button => button.textContent)
    expect(buttons.filter(name => /CSV|PDF/.test(name ?? ''))).toEqual(['What was sent to payroll (CSV)', 'Hours report (live) PDF', 'Hours report (live) CSV'])
    expect(screen.getByText('The hours AIRE froze at the lock, as in this table.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'What was sent to payroll (CSV)' }))
    await settle()
    expect(mocks.downloadPayrollBatch).toHaveBeenCalledWith('AIRE-PAY-20261031-OCT')
    expect(mocks.downloadHoursReport).not.toHaveBeenCalled()
  })
})

describe('pay period page: past periods and other states', () => {
  it('opens a past period at its own address with every step done', async () => {
    await open('/admin/payroll/periods/2026-10-16')
    expect(mocks.period).toHaveBeenCalledWith('2026-10-16')
    expect(screen.getByRole('heading', { level: 1, name: 'Oct 16–31 pay period' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to the current pay period' })).toHaveAttribute('href', '/admin/payroll')
    expect(within(screen.getByRole('list', { name: 'Status' })).getByText('Paid')).toBeInTheDocument()
    expect(steps().getAllByRole('listitem').map(item => item.getAttribute('data-state'))).toEqual(['done', 'done', 'done', 'done', 'done'])
    expect(screen.getByRole('link', { name: 'Open Pay stubs' })).toHaveAttribute('href', '/admin/pay-stubs')
    expect(screen.queryByRole('button', { name: 'Lock now' })).not.toBeInTheDocument()
    // No carried hours from Oct 16–31, so the section stays away.
    expect(screen.queryByRole('region', { name: /Hours carried to a later period/ })).not.toBeInTheDocument()
  })

  it('lists earlier periods and steps between periods', async () => {
    await open()
    const earlier = within(screen.getByRole('region', { name: 'Earlier pay periods' }))
    expect(earlier.getByRole('link', { name: /Oct 16–31/ })).toHaveAttribute('href', '/admin/payroll/periods/2026-10-16')
    expect(earlier.getByRole('link', { name: /Oct 16–31/ })).toHaveTextContent('Locked Nov 2 · paid Nov 10 · 30 people · 1,962.4h')
    fireEvent.click(screen.getByRole('button', { name: 'Previous pay period' }))
    await settle()
    expect(screen.getByTestId('location')).toHaveTextContent('/admin/payroll/periods/2026-10-16')
    expect(screen.getByRole('heading', { level: 1, name: 'Oct 16–31 pay period' })).toBeInTheDocument()
  })

  it('keeps old period links from Today and Reports landing on the period', async () => {
    await open('/admin/payroll?start_date=2026-10-16&end_date=2026-10-31&user_id=7&entry_id=601')
    expect(screen.getByRole('heading', { level: 1, name: 'Oct 16–31 pay period' })).toBeInTheDocument()
    // The linked person's row is open with the linked shift marked.
    expect(screen.getByText(/Tue, Oct 20 · Ground Operations/).closest('li')).toHaveClass('ring-2')
  })

  it('sends old batch links and custom ranges to the payroll records', async () => {
    await open('/admin/payroll?batch_id=AIRE-PAY-20261031-OCT&entry_id=601')
    await settle()
    expect(screen.getByRole('heading', { name: 'Payroll records' })).toBeInTheDocument()
    expect(mocks.getPayrollBatch).toHaveBeenCalledWith('AIRE-PAY-20261031-OCT')
  })

  it('opens the records page for a range that is not a pay period', async () => {
    await open('/admin/payroll?start_date=2026-11-03&end_date=2026-11-09')
    expect(screen.getByRole('heading', { name: 'Payroll records' })).toBeInTheDocument()
  })

  it('explains when Cornerstone Payroll has not published a period, with the manual tools under More', async () => {
    mocks.periods.mockResolvedValue({ data: periodsIndex([], null) })
    publish()
    mocks.getPayrollCutoff.mockResolvedValue({ data: cutoff(null) })
    mocks.previewPayrollBatch.mockResolvedValue({ data: preview({ published_calendar_periods: [] }) })
    await open()
    expect(screen.getByText(/Cornerstone Payroll hasn't published a pay period yet. Hours are still tracked./)).toBeInTheDocument()
    expect(within(screen.getByRole('list', { name: 'Status' })).getByText('Not published')).toBeInTheDocument()
    expect(within(screen.getByRole('list', { name: 'Status' })).getByText('Connected to Cornerstone Payroll')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'More payroll actions' }))
    expect(screen.getByRole('menuitem', { name: 'Finalize without a published period…' })).toBeEnabled()
    expect(screen.getByRole('menuitem', { name: 'Record payroll done outside the connection…' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Finalize without a published period…' }))
    expect(screen.getByRole('dialog', { name: 'Finalize this payroll cutoff?' })).toBeInTheDocument()
  })

  it('says the connection is not set up yet when Cornerstone Payroll has never answered', async () => {
    mocks.connection.mockResolvedValue({ data: connection({ last_publication: null, last_delivery: null, account_link: null }) })
    await open()
    expect(within(screen.getByRole('list', { name: 'Status' })).getByText('Not connected yet')).toBeInTheDocument()
  })

  it('only offers to finalize without a published period when none is published', async () => {
    await open()
    fireEvent.click(screen.getByRole('button', { name: 'More payroll actions' }))
    expect(screen.queryByRole('menuitem', { name: /Finalize without/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Record payroll done outside the connection…' }))
    expect(screen.getByRole('dialog', { name: 'Record payroll done outside the connection' })).toBeInTheDocument()
  })

  it('shows the paused connection and holds the lock control and manual tools', async () => {
    const paused = { mode: 'paused', enabled: false, message: 'Paused' } as const
    mocks.periods.mockResolvedValue({ data: { ...periodsIndex(), connected_payroll: paused } })
    mocks.connection.mockResolvedValue({ data: connection({ state: 'paused', mode: 'paused', enabled: false }) })
    mocks.getPayrollCutoff.mockResolvedValue({ data: { ...cutoff(), connected_payroll: paused } })
    await open()
    expect(screen.getByRole('alert')).toHaveTextContent('Payroll connection paused.')
    expect(within(screen.getByRole('list', { name: 'Status' })).getByText('Payroll connection paused')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Lock now' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'More payroll actions' }))
    expect(screen.queryByRole('menuitem', { name: /Record payroll/ })).not.toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'All payroll records' })).toBeInTheDocument()
  })

  it('shows a period from before locking without a checklist or a preview', async () => {
    const before = periodSummary({ start_date: '2026-10-01', end_date: '2026-10-15', pay_date: '2026-10-25', lock_mode: 'manual', handoff_state: 'before_locking', label: 'Before locking', status: 'scheduled' })
    publish(periodSummary(), paidPeriod(), before)
    await open('/admin/payroll/periods/2026-10-01')
    expect(within(screen.getByRole('list', { name: 'Status' })).getByText('Before locking')).toBeInTheDocument()
    // Codex finding 1: no claim that it was paid.
    expect(screen.getByText(/AIRE didn't lock hours for this pay period, so nothing went to payroll from here/)).toBeInTheDocument()
    expect(screen.queryByText(/was paid/)).not.toBeInTheDocument()
    expect(mocks.getPendingApprovals).not.toHaveBeenCalled()
    expect(screen.queryByRole('region', { name: /Before it locks/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: /What goes to payroll/ })).not.toBeInTheDocument()
    expect(mocks.previewPayrollBatch).not.toHaveBeenCalled()
  })

  it('refuses a start date that is not the 1st or the 16th', async () => {
    await open('/admin/payroll/periods/2026-11-03')
    expect(screen.getByRole('alert')).toHaveTextContent("That isn't a pay period.")
    expect(mocks.period).not.toHaveBeenCalled()
  })

  it('says when a past period was never published', async () => {
    await open('/admin/payroll/periods/2026-09-01')
    expect(screen.getByText(/Cornerstone Payroll didn't publish a pay period for Sep 1–15/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'See its payroll records' })).toHaveAttribute('href', '/admin/payroll/records?start_date=2026-09-01&end_date=2026-09-15')
  })
})
