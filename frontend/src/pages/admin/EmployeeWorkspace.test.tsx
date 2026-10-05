import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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

})
