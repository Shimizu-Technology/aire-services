vi.mock('../../components/time-tracking/PayrollCutoffNotice', () => ({ default: () => null }))
import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import TimeTracking from './TimeTracking'
import type { HoursReportResponse } from '../../lib/api'

const apiMock = vi.hoisted(() => ({
  getSchedule: vi.fn(),
  getTimeEntry: vi.fn(),
  getTimeEntries: vi.fn(),
  getTimeCategories: vi.fn(),
  getUsers: vi.fn(),
  getCurrentUser: vi.fn(),
  getAdminAppSettings: vi.fn(),
  getPendingApprovals: vi.fn(),
  getHoursReport: vi.fn(),
  downloadHoursReport: vi.fn(),
}))
vi.mock('../../lib/api', () => ({ api: apiMock }))
vi.mock('../../contexts/AuthContext', () => ({
  useAuthContext: () => ({ isClerkEnabled: true, userRole: 'admin' }),
}))

const report: HoursReportResponse = {
  start_date: '2026-08-01', end_date: '2026-08-15', context_start_date: '2026-08-01', context_end_date: '2026-08-15',
  generated_at: '2026-08-31T00:00:00Z', ready: false,
  quality: { status: 'needs_review', missing_category_count: 1, missing_description_count: 0, long_shift_count: 0, overlapping_entry_count: 0 },
  filters: {},
  summary: {
    employee_count: 0, total_hours: 4, regular_hours: 4, overtime_hours: 0, break_hours: 0, entries_count: 1,
    pending_count: 0, denied_count: 0, pending_overtime_count: 0, denied_overtime_count: 0, open_clock_count: 0, uncategorized_count: 1,
  },
  breakdowns: { by_category: [], by_source: [] },
  employees: [{
    id: 7, email: 'casey@example.test', first_name: 'Casey', last_name: 'Employee', display_name: 'Casey Employee', full_name: 'Casey Employee',
    role: 'employee', is_intern: false, status: 'active', terminated_at: null, termination_effective_on: null,
    total_hours: 4, regular_hours: 4, overtime_hours: 0, break_hours: 0, entries_count: 1, days_worked: 1,
    first_work_date: '2026-08-03', last_work_date: '2026-08-03', ready: false,
    quality: { status: 'needs_review', missing_category_count: 1, missing_description_count: 0, long_shift_count: 0, overlapping_entry_count: 0 },
    issues: { pending_count: 0, denied_count: 0, pending_overtime_count: 0, denied_overtime_count: 0, open_clock_count: 0, uncategorized_count: 1 },
    categories: [], weeks: [], days: [],
  }],
}

describe('hours report draft confirmation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    apiMock.getTimeEntry.mockResolvedValue({ error: 'No linked fixture', status: 404 })
    apiMock.getTimeEntries.mockResolvedValue({ data: { time_entries: [] } })
    apiMock.getTimeCategories.mockResolvedValue({ data: { time_categories: [] } })
    apiMock.getUsers.mockResolvedValue({ data: { users: [] } })
    apiMock.getCurrentUser.mockResolvedValue({ data: { user: { id: 1, is_admin: true } } })
    apiMock.getAdminAppSettings.mockResolvedValue({ data: { approval_groups: [] } })
    apiMock.getPendingApprovals.mockResolvedValue({ data: { pending_entries: [], count: 0, summary: null } })
    apiMock.getHoursReport.mockResolvedValue({ data: report })
    apiMock.downloadHoursReport.mockImplementation(async (_type: string, _params: unknown, acknowledgeDraft: boolean) => acknowledgeDraft
      ? { blob: new Blob(['pdf']), filename: 'AIRE_Report_DRAFT.pdf' }
      : { error: 'Draft acknowledgement required', code: 'draft_acknowledgement_required' })
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:report')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  })
  afterEach(() => vi.restoreAllMocks())

  const openReport = async () => {
    render(<MemoryRouter initialEntries={['/admin/time?tab=reports&start_date=2026-08-01&end_date=2026-08-15']}><TimeTracking /></MemoryRouter>)
    const pdf = await screen.findByRole('button', { name: /Download PDF Report/ })
    await waitFor(() => expect(pdf).toBeEnabled())
    fireEvent.click(pdf)
    return screen.findByRole('alertdialog', { name: 'Download a clearly marked draft anyway?' })
  }

  it('downloads nothing when the draft is declined', async () => {
    const dialog = await openReport()
    expect(dialog).toHaveTextContent('This report includes approved entries without work categories.')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(apiMock.downloadHoursReport).toHaveBeenCalledTimes(1)
    expect(URL.createObjectURL).not.toHaveBeenCalled()
  })

  it('downloads the acknowledged draft after confirmation', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const dialog = await openReport()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Download draft' }))
    await waitFor(() => expect(apiMock.downloadHoursReport).toHaveBeenLastCalledWith('pdf', expect.any(Object), true))
    await waitFor(() => expect(click).toHaveBeenCalledOnce())
  })
})
