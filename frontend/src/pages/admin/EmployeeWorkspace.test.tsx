import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import EmployeeWorkspace from './EmployeeWorkspace'

const mock = vi.hoisted(() => ({ user: vi.fn(), periods: vi.fn(), period: vi.fn() }))
vi.mock('../../lib/employeeEvidenceApi', () => ({ employeeEvidenceApi: mock }))
const totals = { worked_hours: 12, eligible_hours: 12, pending_hours: 3, denied_hours: 0, issued_hours: 6, committed_hours: 4, exported_hours: 0, held_hours: 0, needs_reconciliation_hours: 2, current_regular_hours: 12, current_overtime_hours: 0, frozen_regular_hours: 10, frozen_overtime_hours: 0, open_case_count: 0 }
const period = { id: '2026-09-01', start_date: '2026-09-01', end_date: '2026-09-15', summary: totals, review_required: true, entries: [{ id: '19', work_date: '2026-09-08', start_time: '09:00', end_time: '17:00', worked_hours: 12, regular_hours: 12, overtime_hours: 0, issued_hours: 6, committed_hours: 4, needs_reconciliation_hours: 2, category: 'Operations', approval_status: 'approved', description: 'Saved source work' }], coverage_lines: [{ id: 'line1', batch_id: 'batch1', source_time_entry_id: '19', source_kind: 'current', coverage_state: 'issued', regular_hours: 6, overtime_hours: 0, work_date: '2026-09-08', external_pay_period_id: '30', external_payroll_item_id: '99', payment_reference: '1001' }], settlement_cases: [] }
function Address() { return <output aria-label="Current address">{useLocation().pathname}{useLocation().search}</output> }
function open(path = '/admin/users/7?tab=hours&return_to=%2Fadmin%2Ftime%3Fuser_id%3D7') {
  render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/admin/users/:id" element={<EmployeeWorkspace />} /></Routes><Address /></MemoryRouter>)
}
beforeEach(() => {
  mock.user.mockResolvedValue({ user: { id: 7, full_name: 'Casey Employee', employment_status: 'terminated', personal_access_enabled: false, time_tracking_enabled: true } })
  mock.periods.mockResolvedValue({ employee: { id: '7', payroll_integration_id: 'employee-uuid' }, integration: { source_instance_id: 'installation-uuid' }, as_of: '2026-10-05T10:00:00Z', totals, periods: [period], evidence_note: 'Source coverage is not actual check REG/OT.', pagination: { total_count: 105, next_cursor: 'next-page' } })
  mock.period.mockResolvedValue({ period, employee: { id: '7', payroll_integration_id: 'employee-uuid' }, integration: { source_instance_id: 'installation-uuid' } })
})
describe('employee workspace', () => {
  it('shows complete totals, original-work evidence and exact connected navigation', async () => {
    open()
    await screen.findByRole('heading', { name: 'Casey Employee' })
    expect(screen.getAllByText('Issued source coverage', { selector: 'dt' })[0]).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Review period' }))
    await screen.findByText('Daily entries')
    fireEvent.click(screen.getByRole('button', { name: /2026-09-08/ }))
    await screen.findByRole('link', { name: 'Open time entry' })
    expect(screen.getByRole('link', { name: 'Open time entry' })).toHaveAttribute('href', expect.stringContaining('user_id=7'))
    expect(screen.getByRole('link', { name: 'Open time entry' })).toHaveAttribute('href', expect.stringContaining('date=2026-09-08&view=day'))
    expect(screen.getByRole('link', { name: 'Open frozen batch' })).toHaveAttribute('href', expect.stringContaining('batch_id=batch1'))
    expect(screen.getByLabelText('Current address')).toHaveTextContent('period=2026-09-01&entry=19')
    expect(screen.getByRole('link', { name: 'Back to previous view' })).toHaveAttribute('href', '/admin/time?user_id=7')
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Hours & payroll' })).toHaveClass('bg-slate-900', 'text-white')
    expect(screen.getByRole('link', { name: 'Hours & payroll' })).not.toHaveClass('bg-white', 'text-slate-800')
  })
  it('restores exact selection from a refreshed URL', async () => {
    open('/admin/users/7?tab=hours&period=2026-09-01&entry=19&start_date=2026-09-01')
    await screen.findByText('Saved source work')
    expect(mock.period).toHaveBeenCalledWith('7', '2026-09-01', expect.any(URLSearchParams), expect.any(AbortSignal))
    expect(mock.period.mock.calls.at(-1)?.[2].get('entry_id')).toBe('19')
    expect(screen.getByLabelText('From work date')).toHaveValue('2026-09-01')
  })
  it('opens a linked older period even when it is beyond the list page', async () => {
    mock.periods.mockResolvedValueOnce({ employee: { id: '7', payroll_integration_id: 'employee-uuid' }, integration: { source_instance_id: 'installation-uuid' }, as_of: '2026-10-05T10:00:00Z', totals, periods: [], evidence_note: 'Evidence', pagination: { total_count: 105, next_cursor: 'next-page' } })
    open('/admin/users/7?tab=hours&period=2026-09-01&entry=19')
    await screen.findByText('Saved source work')
    expect(screen.getByRole('link', { name: 'Open time entry' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show all period entries' })).toBeInTheDocument()
  })
  it('reports failures with retry rather than presenting zero work', async () => {
    mock.periods.mockRejectedValueOnce(new Error('Evidence temporarily unavailable'))
    open()
    expect(await screen.findByRole('alert')).toHaveTextContent('Evidence temporarily unavailable')
    expect(screen.queryByText('Worked')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await screen.findByRole('heading', { name: 'Casey Employee' })
  })
  it('rejects evidence for another person', async () => {
    mock.periods.mockResolvedValueOnce({ employee: { id: '8' } })
    open()
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('identity does not match'))
    expect(screen.queryByRole('heading', { name: 'Casey Employee' })).not.toBeInTheDocument()
  })
  it('refuses a saved reciprocal link for a changed installation or employee UUID', async () => {
    open('/admin/users/7?tab=hours&source_user_uuid=old-employee&source_instance_id=installation-uuid')
    expect(await screen.findByRole('alert')).toHaveTextContent('saved employee link no longer matches')
    expect(screen.queryByRole('heading', { name: 'Casey Employee' })).not.toBeInTheDocument()
  })
  it('keeps verified identities on overview shortcuts and opens the report tab', async () => {
    open('/admin/users/7?source_user_uuid=employee-uuid&source_instance_id=installation-uuid')
    await screen.findByRole('heading', { name: 'Casey Employee' })
    const hours = screen.getByRole('link', { name: 'Review hours & payroll' })
    expect(hours).toHaveAttribute('href', expect.stringContaining('source_user_uuid=employee-uuid'))
    expect(hours).toHaveAttribute('href', expect.stringContaining('source_instance_id=installation-uuid'))
    expect(screen.getByRole('link', { name: 'Open hours report' })).toHaveAttribute('href', expect.stringContaining('tab=reports'))
  })

  it('explains cancelled payment coverage as committed hours reserved for replacement', async () => {
    const cancelled = { ...period, coverage_lines: period.coverage_lines.map((line) => ({ ...line, status: 'payment_cancelled', coverage_state: 'committed' })) }
    mock.period.mockResolvedValueOnce({ period: cancelled, employee: { id: '7', payroll_integration_id: 'employee-uuid' }, integration: { source_instance_id: 'installation-uuid' } })
    open('/admin/users/7?tab=hours&period=2026-09-01&entry=19')
    expect(await screen.findByText('Payment cancelled. Payroll remains committed and these hours stay reserved for the replacement.')).toBeInTheDocument()
  })

  it('labels a bank receipt as a transfer instead of a paper check', async () => {
    const bankPeriod = { ...period, coverage_lines: period.coverage_lines.map(line => ({ ...line, payment_method: 'direct_deposit', payment_reference: 'SYNTHETIC-BANK' })) }
    mock.period.mockResolvedValueOnce({ period: bankPeriod, employee: { id: '7', payroll_integration_id: 'employee-uuid' }, integration: { source_instance_id: 'installation-uuid' } })
    open('/admin/users/7?tab=hours&period=2026-09-01&entry=19')
    expect(await screen.findByText(/bank transfer SYNTHETIC-BANK/)).toBeInTheDocument()
    expect(screen.queryByText(/check SYNTHETIC-BANK/)).not.toBeInTheDocument()
  })

})


it('shows the signed accounting correction separately and preserves the original issued coverage', async () => {
  const context = { accounting_only: true, correction_disposition_id: '9', original_pay_period_id: '30', original_payroll_item_id: '99', corrective_pay_period_id: '44', corrective_payroll_item_id: '55' }
  const corrected = { ...period, review_required: false, summary: { ...totals, worked_hours: 3, eligible_hours: 3, pending_hours: 0, issued_hours: 4, committed_hours: 0, needs_reconciliation_hours: 0, open_case_count: 1, accounting_correction_hours: -1, accounting_correction_line_count: 1 },
    coverage_lines: [...period.coverage_lines, { ...period.coverage_lines[0], id: 'correction', source_kind: 'correction', status: 'committed', coverage_state: 'committed', accounting_only: true, accounting_correction: context, regular_hours: -1, total_hours: -1, external_pay_period_id: '44', external_payroll_item_id: '55', payment_reference: null, payment_method: null }],
  }
  mock.periods.mockResolvedValue({ employee: { id: '7', payroll_integration_id: 'employee-uuid' }, integration: { source_instance_id: 'installation-uuid' }, as_of: '2026-10-05T10:00:00Z', totals: corrected.summary, periods: [corrected], pagination: { total_count: 1, next_cursor: null } })
  mock.period.mockResolvedValue({ period: corrected, employee: { id: '7', payroll_integration_id: 'employee-uuid' }, integration: { source_instance_id: 'installation-uuid' } })
  open()
  fireEvent.click(await screen.findByRole('button', { name: 'Review period' }))
  expect(await screen.findByText(/correction · Accounting correction committed · REG -1h/)).toBeInTheDocument()
  expect(screen.getByText(/No new payment or recovery recorded/)).toBeInTheDocument()
  expect(screen.getByText(/item 55/)).toBeInTheDocument()
  expect(screen.getByText(/item 99/)).toHaveTextContent('1001')
  expect(screen.queryByText(/correction.*payment reference Not recorded/)).not.toBeInTheDocument()
  expect(screen.getByText(/Original work dates · Review recorded evidence/)).toBeInTheDocument()
  expect(screen.queryByText(/Original work dates · Needs reconciliation/)).not.toBeInTheDocument()
})

it('keeps late-created paid case history visible without an unresolved-period badge', async () => {
  const carried = { ...period, review_required: false,
    summary: { ...totals, worked_hours: 4, eligible_hours: 4, pending_hours: 0, issued_hours: 4, committed_hours: 0, needs_reconciliation_hours: 0, open_case_count: 1 },
    settlement_cases: [{ public_id: 'historical-case', source_time_entry_id: '19', origin_reason: 'created_after_cutoff', status: 'in_payroll', completion: 'paid', target_pay_date: '2026-10-30', destination_kind: 'regular', target_external_pay_period_id: 'next-period', action_due_on: '2026-10-15' }],
  }
  mock.periods.mockResolvedValue({ employee: { id: '7', payroll_integration_id: 'employee-uuid' }, integration: { source_instance_id: 'installation-uuid' }, as_of: '2026-10-05T10:00:00Z', totals: carried.summary, periods: [carried], pagination: { total_count: 1, next_cursor: null } })
  mock.period.mockResolvedValue({ period: carried, employee: { id: '7', payroll_integration_id: 'employee-uuid' }, integration: { source_instance_id: 'installation-uuid' } })
  open()
  fireEvent.click(await screen.findByRole('button', { name: 'Review period' }))
  expect(await screen.findByText('Historical reason: created after cutoff')).toBeInTheDocument()
  expect(screen.getByRole('region', { name: 'Reconciliation notes' })).toHaveTextContent('Paid')
  expect(screen.getByText('Regular payroll · Pay date Fri, Oct 30, 2026')).toBeInTheDocument()
  expect(screen.getByText('Recorded follow-up date: Thu, Oct 15, 2026')).toBeInTheDocument()
  expect(screen.getByText('Stored status: in_payroll · Payroll reference: next-period')).toBeInTheDocument()
  expect(screen.getByText(/Original work dates · Review recorded evidence/)).toBeInTheDocument()
  expect(screen.queryByText(/Original work dates · Needs reconciliation/)).not.toBeInTheDocument()
})

it.each([
  { completion: null, status: 'in_payroll', destination_kind: 'supplemental', label: 'Included in payroll · receipt confirmation pending', destination: 'Supplemental payroll · Pay date unavailable' },
  { completion: undefined, status: 'in_payroll', destination_kind: 'regular', label: 'Included in payroll · receipt confirmation pending', destination: 'Regular payroll · Pay date unavailable' },
  { completion: 'accounting_recorded', status: 'in_payroll', destination_kind: 'supplemental', label: 'Accounting correction committed', destination: 'Supplemental payroll · Pay date unavailable' },
  { completion: null, status: 'scheduled', destination_kind: 'regular', label: 'Scheduled', destination: 'Regular payroll · Pay date unavailable' },
  { completion: null, status: 'open', destination_kind: 'unassigned', label: 'Needs review', destination: 'No destination assigned' },
])('renders truthful $label history without deriving a payday from the due date', async (item) => {
  const history = { ...period, settlement_cases: [{ ...item, target_pay_date: null, public_id: 'case', source_time_entry_id: '19', origin_reason: 'pending_overtime', target_external_pay_period_id: 'long-audit-payroll-reference', action_due_on: '2026-12-15' }] }
  mock.period.mockResolvedValue({ period: history, employee: { id: '7', payroll_integration_id: 'employee-uuid' }, integration: { source_instance_id: 'installation-uuid' } })
  open('/admin/users/7?tab=hours&period=2026-09-01')
  const notes = await screen.findByRole('region', { name: 'Reconciliation notes' })
  expect(within(notes).getByText(item.label)).toBeInTheDocument()
  expect(within(notes).getByText(item.destination)).toBeInTheDocument()
  expect(notes).toHaveTextContent('Historical reason: pending overtime')
  expect(notes).toHaveTextContent('Recorded follow-up date: Tue, Dec 15, 2026')
  expect(notes).toHaveTextContent('Payroll reference: long-audit-payroll-reference')
  expect(within(notes).queryByText('Paid', { exact: true })).not.toBeInTheDocument()
  expect(within(notes).queryByText(/Pay date.*Dec 15/)).not.toBeInTheDocument()
})
