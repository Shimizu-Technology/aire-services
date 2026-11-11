import '@testing-library/jest-dom'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { LATE_HOURS_NOTICE } from '../../lib/payrollCutoffCopy'
import ApprovalQueue from './ApprovalQueue'
import type { PendingApprovalsSummary, TimeCategory, TimeEntry } from '../../lib/api'

const apiMock = vi.hoisted(() => ({
  getPendingApprovals: vi.fn(),
  getTimeCategories: vi.fn(),
  approveTimeEntry: vi.fn(),
  approveOvertime: vi.fn(),
  denyTimeEntry: vi.fn(),
  denyOvertime: vi.fn(),
  bulkApproveTimeEntries: vi.fn(),
}))

vi.mock('../../lib/api', () => ({
  api: apiMock,
}))

const authMock = vi.hoisted(() => ({ currentUser: null as { id: number } | null }))
vi.mock('../../contexts/AuthContext', () => ({ useAuthContext: () => ({ currentUser: authMock.currentUser }) }))

// The dialog's description is the summary sentence followed by its details.
function startsWith(text: string) {
  return new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`)
}

function makeEntry(overrides: Partial<TimeEntry>): TimeEntry {
  return {
    id: 1,
    work_date: '2026-06-05',
    start_time: '08:00',
    end_time: '10:00',
    formatted_start_time: '8:00 AM',
    formatted_end_time: '10:00 AM',
    hours: 2,
    break_minutes: 0,
    description: 'SIDA Badge appointment',
    entry_method: 'manual',
    clock_source: null,
    status: 'completed',
    admin_override: false,
    attendance_status: null,
    approval_status: 'pending',
    overtime_status: 'none',
    approval_reasons: [{ key: 'manual_entry', label: 'Manual entry' }],
    clock_in_at: null,
    clock_out_at: null,
    approved_by: null,
    approved_at: null,
    approval_note: null,
    overtime_approved_by: null,
    overtime_approved_at: null,
    overtime_note: null,
    schedule: null,
    breaks: [],
    user: {
      id: 10,
      email: 'aika@example.com',
      display_name: 'Aika Kanekatsu',
      full_name: 'Aika Kanekatsu',
      approval_group: 'cfi',
      approval_group_label: 'CFI',
      approval_group_keys: ['cfi'],
      approval_group_labels: ['CFI'],
    },
    time_category: {
      id: 1,
      key: 'cfi',
      name: 'CFI',
    },
    created_at: '2026-06-05T00:00:00.000Z',
    updated_at: '2026-06-05T00:00:00.000Z',
    ...overrides,
  }
}

const entries = [
  makeEntry({ id: 1, work_date: '2026-06-05' }),
  makeEntry({
    id: 2,
    work_date: '2026-06-06',
    hours: 1.5,
    description: 'Overtime checkout flight',
    approval_status: 'approved',
    overtime_status: 'pending',
    approval_reasons: [{ key: 'overtime', label: 'Overtime' }],
    user: {
      id: 11,
      email: 'zion@example.com',
      display_name: 'Zion Quintanilla',
      full_name: 'Zion Quintanilla',
      approval_group: 'ops_maintenance',
      approval_group_label: 'Maintenance',
      approval_group_keys: ['ops_maintenance'],
      approval_group_labels: ['Maintenance'],
    },
  }),
]

const categories: TimeCategory[] = [
  { id: 1, key: 'cfi', name: 'CFI', description: null },
  { id: 2, key: 'other', name: 'Other', description: null },
]

const summary: PendingApprovalsSummary = {
  total_hours: 3.5,
  entry_count: 2,
  oldest_work_date: '2026-06-05',
  newest_work_date: '2026-06-06',
  pending_time_entry_count: 1,
  pending_overtime_count: 1,
  manual_count: 1,
  clock_count: 1,
  counts_by_date: [
    { work_date: '2026-06-05', count: 1, hours: 2 },
    { work_date: '2026-06-06', count: 1, hours: 1.5 },
  ],
  counts_by_approval_group: [
    { key: 'cfi', label: 'CFI', count: 99 },
    { key: 'ops_maintenance', label: 'Maintenance', count: 14 },
    { key: 'unassigned', label: 'Unassigned', count: 7 },
  ],
}

describe('ApprovalQueue review workflow', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    authMock.currentUser = null
    apiMock.getPendingApprovals.mockResolvedValue({ data: { pending_entries: entries, count: entries.length, summary } })
    apiMock.getTimeCategories.mockResolvedValue({ data: { time_categories: categories } })
  })

  it.each([
    ['Today', { date: '2026-11-01' }],
    ['Yesterday', { date: '2026-10-31' }],
    ['This week', { start_date: '2026-11-01', end_date: '2026-11-07' }],
    ['Last week', { start_date: '2026-10-25', end_date: '2026-10-31' }],
    ['Through today', { through_date: '2026-11-01' }],
  ])('uses Guam for the %s quick date filter', async (label, expected) => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-31T14:30:00Z'))
    try {
      render(<ApprovalQueue approvalGroups={[]} approvalGroupsLoaded canManageTeamTime />)
      fireEvent.click(await screen.findByRole('button', { name: label }))
      await waitFor(() => expect(apiMock.getPendingApprovals).toHaveBeenLastCalledWith(expect.objectContaining(expected)))
    } finally {
      vi.useRealTimers()
    }
  })

  it.each([true, false])('passes the admin role (%s) to the denied overtime editor', async (canManageTeamTime) => {
    const denied = makeEntry({ version: 7, approval_status: 'denied', overtime_status: 'pending' })
    apiMock.getPendingApprovals.mockResolvedValue({ data: { pending_entries: [denied], count: 1, summary } })
    render(<ApprovalQueue approvalGroups={[]} approvalGroupsLoaded canManageTeamTime={canManageTeamTime} canDeleteEntry={() => true} />)
    fireEvent.click(await screen.findByTitle('Edit entry'))
    const dialog = screen.getByRole('dialog', { name: 'Edit Time Entry' })
    expect(within(dialog).getByLabelText('End Time *')).toHaveValue('10:00')
    const resubmit = within(dialog).queryByRole('checkbox', { name: 'Submit denied time for review' })
    if (canManageTeamTime) expect(resubmit).toBeVisible()
    else expect(resubmit).not.toBeInTheDocument()
  })

  it('retains the employee filter label and scope after approving their last pending entry', async () => {
    let approved = false
    apiMock.getPendingApprovals.mockImplementation(async (params) => {
      const pending = approved ? [entries[1]] : entries
      const filtered = params.user_id ? pending.filter((entry) => entry.user.id === params.user_id) : pending
      return { data: { pending_entries: filtered, count: filtered.length } }
    })
    apiMock.approveTimeEntry.mockImplementation(async () => {
      approved = true
      return { data: {} }
    })
    render(<ApprovalQueue approvalGroups={[]} approvalGroupsLoaded canDeleteEntry={() => true} />)

    await screen.findByRole('option', { name: 'Aika Kanekatsu' })
    fireEvent.change(screen.getByDisplayValue('All employees'), { target: { value: '10' } })
    await waitFor(() => expect(apiMock.getPendingApprovals).toHaveBeenLastCalledWith(expect.objectContaining({ user_id: 10 })))
    await waitFor(() => expect(screen.queryByText('Zion Quintanilla')).not.toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))

    await screen.findByText(/No pending entries match these filters/)
    const employeeSelect = screen.getByDisplayValue('Aika Kanekatsu') as HTMLSelectElement
    expect(employeeSelect).toHaveValue('10')
    expect(employeeSelect.selectedOptions[0]).toHaveTextContent('Aika Kanekatsu')
    expect(apiMock.getPendingApprovals).toHaveBeenLastCalledWith(expect.objectContaining({ user_id: 10 }))
    expect(apiMock.approveTimeEntry).toHaveBeenCalledTimes(1)
    expect(apiMock.approveTimeEntry).toHaveBeenCalledWith(1, undefined)
    expect(screen.queryByText('Zion Quintanilla')).not.toBeInTheDocument()
    expect(screen.getByText('Clear filters')).toBeVisible()

    fireEvent.click(screen.getByText('Clear filters'))
    await screen.findByRole('option', { name: 'Zion Quintanilla' })
    expect(screen.getByDisplayValue('All employees')).toBeVisible()
    expect(apiMock.getPendingApprovals.mock.lastCall?.[0]).not.toHaveProperty('user_id')
    expect(apiMock.approveTimeEntry).toHaveBeenCalledTimes(1)
  })

  it('approves time and overtime with one button that names the overtime', async () => {
    const entry = makeEntry({ id: 71, overtime_status: 'pending', pending_overtime_hours: 1.14 })
    apiMock.getPendingApprovals.mockResolvedValue({ data: { pending_entries: [entry], count: 1 } })
    apiMock.approveTimeEntry.mockResolvedValue({ data: {} })
    render(<ApprovalQueue approvalGroups={[]} approvalGroupsLoaded canDeleteEntry={() => true} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Approve time + 1.14 OT' }))

    await waitFor(() => expect(apiMock.approveTimeEntry).toHaveBeenCalledWith(71, undefined, { includeOvertime: true }))
    expect(apiMock.approveOvertime).not.toHaveBeenCalled()
  })

  it('keeps the plain label when the entry has no real overtime hours', async () => {
    const entry = makeEntry({ id: 72, overtime_status: 'pending', pending_overtime_hours: 0 })
    apiMock.getPendingApprovals.mockResolvedValue({ data: { pending_entries: [entry], count: 1 } })
    render(<ApprovalQueue approvalGroups={[]} approvalGroupsLoaded canDeleteEntry={() => true} />)

    expect(await screen.findByRole('button', { name: 'Approve' })).toBeVisible()
  })

  it('approves only the time when the overtime hours could not be shown', async () => {
    const entry = makeEntry({ id: 75, overtime_status: 'pending' })
    apiMock.getPendingApprovals.mockResolvedValue({ data: { pending_entries: [entry], count: 1 } })
    apiMock.approveTimeEntry.mockResolvedValue({ data: {} })
    render(<ApprovalQueue approvalGroups={[]} approvalGroupsLoaded canDeleteEntry={() => true} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }))

    await waitFor(() => expect(apiMock.approveTimeEntry).toHaveBeenCalledWith(75, undefined))
  })

  it('names the overtime when only the overtime is waiting', async () => {
    const entry = makeEntry({ id: 73, approval_status: 'approved', overtime_status: 'pending', pending_overtime_hours: 4.77 })
    apiMock.getPendingApprovals.mockResolvedValue({ data: { pending_entries: [entry], count: 1 } })
    apiMock.approveOvertime.mockResolvedValue({ data: {} })
    render(<ApprovalQueue approvalGroups={[]} approvalGroupsLoaded canDeleteEntry={() => true} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Approve 4.77 OT' }))

    await waitFor(() => expect(apiMock.approveOvertime).toHaveBeenCalledWith(73, undefined))
    expect(screen.queryByRole('button', { name: 'Deny OT' })).not.toBeInTheDocument()
  })

  it('asks for a reason before denying only the overtime', async () => {
    const entry = makeEntry({ id: 74, overtime_status: 'pending', pending_overtime_hours: 2 })
    apiMock.getPendingApprovals.mockResolvedValue({ data: { pending_entries: [entry], count: 1 } })
    apiMock.denyOvertime.mockResolvedValue({ data: {} })
    render(<ApprovalQueue approvalGroups={[]} approvalGroupsLoaded canDeleteEntry={() => true} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Deny OT' }))
    expect(await screen.findByText(/Add a reason in the note box/)).toBeVisible()
    expect(apiMock.denyOvertime).not.toHaveBeenCalled()

    fireEvent.change(screen.getByPlaceholderText('Add a note (optional)...'), { target: { value: 'Hours were not worked' } })
    fireEvent.click(screen.getByRole('button', { name: 'Deny OT' }))

    await waitFor(() => expect(apiMock.denyOvertime).toHaveBeenCalledWith(74, 'Hours were not worked'))
    expect(apiMock.denyTimeEntry).not.toHaveBeenCalled()
  })

  it('keeps reversed-range inputs correctable without stale approvals and resumes the selected scope', async () => {
    const target = makeEntry({ id: 48, work_date: '2026-09-23' })
    let approved = false
    apiMock.getPendingApprovals.mockImplementation(async (params) => {
      if (params.start_date && params.end_date && params.end_date < params.start_date) {
        return { error: 'end_date must be on or after start_date' }
      }
      return { data: { pending_entries: approved ? [] : [target], count: approved ? 0 : 1 } }
    })
    apiMock.approveTimeEntry.mockImplementation(async () => {
      approved = true
      return { data: {} }
    })
    const { container } = render(<ApprovalQueue approvalGroups={[]} approvalGroupsLoaded
      initialDateFilter={{ mode: 'range', startDate: '2026-09-23', endDate: '2026-09-23' }} />)
    await screen.findByRole('option', { name: 'Aika Kanekatsu' })
    fireEvent.change(screen.getByDisplayValue('All employees'), { target: { value: '10' } })
    await waitFor(() => expect(apiMock.getPendingApprovals).toHaveBeenLastCalledWith(expect.objectContaining({ user_id: 10 })))
    const [start, end] = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="date"]'))
    const callsBeforeInvalid = apiMock.getPendingApprovals.mock.calls.length
    fireEvent.change(end, { target: { value: '2026-09-14' } })

    expect(await screen.findByText('End date must be on or after start date.')).toBeVisible()
    expect(start).toBeVisible()
    expect(start).toHaveValue('2026-09-23')
    expect(end).toBeVisible()
    expect(end).toHaveValue('2026-09-14')
    expect(screen.getByDisplayValue('Aika Kanekatsu')).toHaveValue('10')
    expect(apiMock.getPendingApprovals).toHaveBeenCalledTimes(callsBeforeInvalid)
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument()
    const bulkApprove = screen.getByRole('button', { name: /Approve Selected/ })
    expect(bulkApprove).toBeDisabled()
    expect(bulkApprove).toHaveTextContent(/^Approve Selected$/)
    expect(screen.getByRole('button', { name: 'Select approvable' })).toBeDisabled()
    fireEvent.click(bulkApprove)
    expect(apiMock.approveTimeEntry).not.toHaveBeenCalled()
    expect(apiMock.bulkApproveTimeEntries).not.toHaveBeenCalled()

    fireEvent.change(end, { target: { value: '2026-09-23' } })
    const approve = await screen.findByRole('button', { name: 'Approve' })
    expect(approve).toBeEnabled()
    expect(apiMock.getPendingApprovals).toHaveBeenLastCalledWith(expect.objectContaining({
      user_id: 10, start_date: '2026-09-23', end_date: '2026-09-23',
    }))
    fireEvent.click(approve)
    await screen.findByText(/No pending entries match these filters/)
    expect(apiMock.approveTimeEntry).toHaveBeenCalledExactlyOnceWith(48, undefined)
    expect(screen.getByDisplayValue('Aika Kanekatsu')).toHaveValue('10')
    expect(start).toHaveValue('2026-09-23')
    expect(end).toHaveValue('2026-09-23')
  })

  it('retains filter controls and hides stale rows on fetch failure until a scoped retry succeeds', async () => {
    render(<ApprovalQueue approvalGroups={[]} approvalGroupsLoaded />)
    await screen.findByRole('option', { name: 'Aika Kanekatsu' })
    apiMock.getPendingApprovals.mockResolvedValueOnce({ error: 'Connection lost' })
    fireEvent.change(screen.getByDisplayValue('All employees'), { target: { value: '10' } })

    expect(await screen.findByText('Connection lost')).toBeVisible()
    expect(screen.getByDisplayValue('Aika Kanekatsu')).toHaveValue('10')
    expect(screen.getByDisplayValue('All dates')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Approve Selected/ })).toBeDisabled()
    expect(screen.getByText('Clear filters')).toBeVisible()
    apiMock.getPendingApprovals.mockResolvedValueOnce({ data: { pending_entries: [entries[0]], count: 1 } })
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('button', { name: 'Approve' })).toBeEnabled()
    expect(apiMock.getPendingApprovals).toHaveBeenLastCalledWith(expect.objectContaining({ user_id: 10 }))
    expect(screen.queryByText('Connection lost')).not.toBeInTheDocument()
  })

  it('defaults to oldest-first approvals and shows review reason badges', async () => {
    render(<ApprovalQueue approvalGroups={[{ key: 'cfi', label: 'CFI' }]} approvalGroupsLoaded canDeleteEntry={() => true} />)

    expect(await screen.findByText('Pending Approvals')).toBeInTheDocument()
    expect(apiMock.getPendingApprovals).toHaveBeenCalledWith({ sort: 'work_date', direction: 'asc', per_page: 500 })
    expect(screen.getByText('Manual entry')).toBeInTheDocument()
    expect(screen.getByText('Overtime')).toBeInTheDocument()
    expect(screen.getByText('Fri, Jun 5, 2026')).toBeInTheDocument()
    expect(screen.getByText('Sat, Jun 6, 2026')).toBeInTheDocument()
    expect(screen.getByText('Approve Selected (0)')).toBeInTheDocument()
    expect(screen.getByText('CFI (99)')).toBeInTheDocument()
    expect(screen.getByText('Unassigned (7)')).toBeInTheDocument()
  })

  it('sends through-date filters to the pending approvals endpoint', async () => {
    const { container } = render(<ApprovalQueue approvalGroups={[]} approvalGroupsLoaded canDeleteEntry={() => true} />)

    await screen.findByText('Pending Approvals')
    fireEvent.change(screen.getByDisplayValue('All dates'), { target: { value: 'through' } })

    const dateInput = container.querySelector<HTMLInputElement>('input[type="date"]')
    expect(dateInput).toBeInTheDocument()
    fireEvent.change(dateInput!, { target: { value: '2026-06-05' } })

    await waitFor(() => {
      expect(apiMock.getPendingApprovals).toHaveBeenCalledWith(expect.objectContaining({ through_date: '2026-06-05' }))
    })
  })

  it('starts with a linked payroll date range', async () => {
    const { rerender } = render(
      <ApprovalQueue
        approvalGroups={[]}
        approvalGroupsLoaded
        initialDateFilter={{ mode: 'range', startDate: '2026-06-01', endDate: '2026-06-15' }}
        canDeleteEntry={() => true}
      />,
    )

    await screen.findByText('Pending Approvals')
    expect(apiMock.getPendingApprovals).toHaveBeenCalledWith(expect.objectContaining({
      start_date: '2026-06-01',
      end_date: '2026-06-15',
    }))
    expect(screen.getByDisplayValue('Date range')).toBeInTheDocument()

    rerender(
      <ApprovalQueue
        approvalGroups={[]}
        approvalGroupsLoaded
        initialDateFilter={{ mode: 'range', startDate: '2026-07-01', endDate: '2026-07-15' }}
        canDeleteEntry={() => true}
      />,
    )

    await waitFor(() => expect(apiMock.getPendingApprovals).toHaveBeenCalledWith(expect.objectContaining({
      start_date: '2026-07-01',
      end_date: '2026-07-15',
    })))
  })

  it('can open approvals through a payroll cutoff date', async () => {
    render(
      <ApprovalQueue
        approvalGroups={[]}
        approvalGroupsLoaded
        initialDateFilter={{ mode: 'through', throughDate: '2026-06-15' }}
        canDeleteEntry={() => true}
      />,
    )

    await screen.findByText('Pending Approvals')
    expect(apiMock.getPendingApprovals).toHaveBeenCalledWith(expect.objectContaining({ through_date: '2026-06-15' }))
    expect(screen.getByDisplayValue('On or before')).toBeInTheDocument()
  })

  it('requires an edit before an uncategorized entry can be selected or approved', async () => {
    const uncategorizedEntry = makeEntry({
      time_category: null,
      user: {
        ...entries[0].user,
        time_category_ids: [1],
      },
    })
    apiMock.getPendingApprovals.mockResolvedValue({
      data: { pending_entries: [uncategorizedEntry], count: 1, summary: { ...summary, entry_count: 1 } },
    })

    render(<ApprovalQueue approvalGroups={[]} approvalGroupsLoaded canDeleteEntry={() => true} />)

    expect(await screen.findByText('Work category required')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /select aika kanekatsu/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Category required' })).toBeDisabled()
    expect(screen.getByText(/edit this entry and choose an assigned work category/i)).toBeInTheDocument()
    expect(screen.getByTitle('Edit entry')).toBeEnabled()
    expect(apiMock.approveTimeEntry).not.toHaveBeenCalled()
    expect(apiMock.bulkApproveTimeEntries).not.toHaveBeenCalled()

    fireEvent.click(screen.getByTitle('Edit entry'))
    const categorySelect = (await screen.findByRole('option', { name: 'Select category...' })).parentElement as HTMLSelectElement
    expect(categorySelect).toHaveValue('')
    expect(within(categorySelect).getByRole('option', { name: 'CFI' })).toBeInTheDocument()
    expect(within(categorySelect).queryByRole('option', { name: 'Other' })).not.toBeInTheDocument()
  })

  it("shows a manager's own pending time read-only when another approver is needed", async () => {
    const own = makeEntry({
      id: 81,
      overtime_status: 'pending',
      pending_overtime_hours: 1.5,
      needs_another_approver: true,
      user: { ...entries[0].user, id: 20, display_name: 'Roke Manager', full_name: 'Roke Manager' },
    })
    const theirs = makeEntry({ id: 82 })
    apiMock.getPendingApprovals.mockResolvedValue({ data: { pending_entries: [own, theirs], count: 2 } })
    apiMock.bulkApproveTimeEntries.mockResolvedValue({ data: { time_entries: [theirs], count: 1 } })
    render(<ApprovalQueue canManageTeamTime approvalGroups={[]} approvalGroupsLoaded canDeleteEntry={() => true} />)

    expect(await screen.findByText('Needs another approver.')).toBeVisible()
    expect(screen.getByRole('checkbox', { name: /select roke manager/i })).toBeDisabled()
    expect(screen.getByRole('checkbox', { name: /select aika kanekatsu/i })).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Approve time + 1.50 OT' })).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Approve' })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: 'Deny' })).toHaveLength(1)
    expect(screen.queryByRole('button', { name: 'Deny OT' })).not.toBeInTheDocument()
    expect(screen.getAllByTitle('Edit entry')).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: 'Select approvable (1)' }))
    fireEvent.click(screen.getByRole('button', { name: 'Approve Selected (1)' }))
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Approve 1 entry' }))
    await waitFor(() => expect(apiMock.bulkApproveTimeEntries).toHaveBeenCalledWith([82]))
    expect(apiMock.approveTimeEntry).not.toHaveBeenCalled()
    expect(apiMock.approveOvertime).not.toHaveBeenCalled()
  })

  it("lets a supervisor approve their own clock time when they may, marked as their own time", async () => {
    const own = makeEntry({
      id: 83,
      entry_method: 'clock',
      clock_source: 'kiosk',
      approval_note: "Clocked in without a schedule | Supervisor's own time",
      approval_reasons: [{ key: 'own_time', label: "Supervisor's own time" }, { key: 'unscheduled_clock', label: 'Unscheduled clock' }],
      needs_another_approver: false,
      user: { ...entries[0].user, id: 20, display_name: 'Roke Manager', full_name: 'Roke Manager' },
    })
    apiMock.getPendingApprovals.mockResolvedValue({ data: { pending_entries: [own], count: 1 } })
    apiMock.approveTimeEntry.mockResolvedValue({ data: { time_entry: { ...own, approval_status: 'approved' } } })
    render(<ApprovalQueue canManageTeamTime approvalGroups={[]} approvalGroupsLoaded canDeleteEntry={() => true} />)

    expect(await screen.findByText("Supervisor's own time")).toBeVisible()
    expect(screen.queryByText('Needs another approver.')).not.toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /select roke manager/i })).toBeEnabled()

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
    await waitFor(() => expect(apiMock.approveTimeEntry).toHaveBeenCalledWith(83, undefined))
  })

  it('identifies card hours as total entry hours rather than the held overtime portion', async () => {
    render(<ApprovalQueue approvalGroups={[]} approvalGroupsLoaded canDeleteEntry={() => true} />)
    expect(await screen.findByText('Only the overtime portion needs review.')).toBeInTheDocument()
    expect(screen.getAllByText('Total entry hours')).toHaveLength(2)
  })


  it.each([true, false])('shows essential approval content before animation timers run (grouped=%s)', async (grouped) => {
    vi.useFakeTimers()
    try {
      await act(async () => {
        render(<ApprovalQueue approvalGroups={[]} approvalGroupsLoaded canDeleteEntry={() => true} />)
      })
      if (!grouped) {
        await act(async () => fireEvent.click(screen.getByRole('checkbox', { name: 'Group by date' })))
      }
      expect(screen.getByRole('checkbox', { name: /Select Zion Quintanilla/i })).toBeVisible()
      expect(screen.getByText('Only the overtime portion needs review.')).toBeVisible()
      screen.getAllByRole('button', { name: 'Approve' }).forEach(button => expect(button).toBeVisible())
      screen.getAllByRole('button', { name: 'Deny' }).forEach(button => expect(button).toBeVisible())
      fireEvent.click(screen.getAllByTitle('Add note')[0])
      expect(screen.getByPlaceholderText('Add a note (optional)...')).toBeVisible()
    } finally {
      vi.useRealTimers()
    }
  })


  it('labels grouped overtime-only hours as total entry hours without inventing a held amount', async () => {
    apiMock.getPendingApprovals.mockResolvedValue({ data: {
      pending_entries: [makeEntry({ ...entries[1], work_date: '2026-11-05', hours: 10 })], count: 1,
      summary: { ...summary, entry_count: 1, total_hours: 10, pending_time_entry_count: 0, pending_overtime_count: 1 },
    } })
    render(<ApprovalQueue approvalGroups={[]} approvalGroupsLoaded canDeleteEntry={() => true} />)
    expect(await screen.findByText('1 entry · 10.00h total entry hours')).toBeVisible()
    expect(screen.queryByText('1 entry · 10.00h pending')).not.toBeInTheDocument()
    expect(screen.getByText('Only the overtime portion needs review.')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Approve' })).toBeEnabled()
  })

})


describe('Late approval guidance', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMock.currentUser = null
    localStorage.clear()
    apiMock.getTimeCategories.mockResolvedValue({ data: { time_categories: categories } })
  })

  it('warns before and after approving late time without blocking the approval', async () => {
    const late = makeEntry({ payroll_cutoff_missed: true })
    apiMock.getPendingApprovals.mockResolvedValue({ data: { pending_entries: [late], count: 1 } })
    apiMock.approveTimeEntry.mockResolvedValue({ data: { time_entry: { ...late, approval_status: 'approved' } } })
    const updated = vi.fn()
    const event = vi.fn()
    window.addEventListener('aire:approvals-updated', event)
    try {
      render(<ApprovalQueue canManageTeamTime approvalGroups={[]} approvalGroupsLoaded onUpdate={updated} />)
      expect(await screen.findByText(`This entry missed the payroll cutoff. ${LATE_HOURS_NOTICE}`)).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
      await waitFor(() => expect(apiMock.approveTimeEntry).toHaveBeenCalledWith(late.id, undefined))
      expect(await screen.findByRole('status')).toHaveTextContent(`Approved. This entry missed the payroll cutoff. ${LATE_HOURS_NOTICE}`)
      await waitFor(() => expect(updated).toHaveBeenCalledOnce())
      expect(event).toHaveBeenCalledOnce()
    } finally { window.removeEventListener('aire:approvals-updated', event) }
  })

  it('uses fresh bulk response context when an entry moved out of a locked period', async () => {
    const late = makeEntry({ payroll_cutoff_missed: true })
    apiMock.getPendingApprovals.mockResolvedValue({ data: { pending_entries: [late], count: 1 } })
    apiMock.bulkApproveTimeEntries.mockResolvedValue({ data: { time_entries: [{ ...late, payroll_cutoff_missed: false }], count: 1 } })
    const updated = vi.fn()
    render(<ApprovalQueue canManageTeamTime approvalGroups={[]} approvalGroupsLoaded onUpdate={updated} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Select approvable (1)' }))
    fireEvent.click(screen.getByRole('button', { name: 'Approve Selected (1)' }))
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Approve 1 entry' }))
    await waitFor(() => expect(updated).toHaveBeenCalledOnce())
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('does not add a late-hours instruction to an on-time bulk confirmation', async () => {
    const current = makeEntry({ payroll_cutoff_missed: false })
    apiMock.getPendingApprovals.mockResolvedValue({ data: { pending_entries: [current], count: 1 } })
    render(<ApprovalQueue canManageTeamTime approvalGroups={[]} approvalGroupsLoaded onUpdate={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Select approvable (1)' }))
    fireEvent.click(screen.getByRole('button', { name: 'Approve Selected (1)' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Approve 1 selected entry?' })
    expect(dialog).toHaveTextContent('Total hours:')
    expect(dialog).not.toHaveTextContent(LATE_HOURS_NOTICE)
    expect(dialog).not.toHaveTextContent('missed the payroll cutoff')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(apiMock.bulkApproveTimeEntries).not.toHaveBeenCalled()
  })

  it('closes the bulk confirmation on Escape without approving', async () => {
    apiMock.getPendingApprovals.mockResolvedValue({ data: { pending_entries: [makeEntry({})], count: 1 } })
    render(<ApprovalQueue canManageTeamTime approvalGroups={[]} approvalGroupsLoaded />)
    fireEvent.click(await screen.findByRole('button', { name: 'Select approvable (1)' }))
    const trigger = screen.getByRole('button', { name: 'Approve Selected (1)' })
    trigger.focus()
    fireEvent.click(trigger)
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByRole('button', { name: 'Approve 1 entry' })).toHaveFocus()
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(trigger).toHaveFocus()
    expect(apiMock.bulkApproveTimeEntries).not.toHaveBeenCalled()
  })

  it('spells out overtime, own shifts and added or edited shifts before a bulk approval', async () => {
    authMock.currentUser = { id: 20 }
    const person = (id: number, name: string) => ({ ...entries[0].user, id, display_name: name, full_name: name })
    const clock = { entry_method: 'clock' as const, clock_source: 'mobile' as const, approval_reasons: [{ key: 'unscheduled_clock', label: 'Unscheduled clock' }] }
    const ordinary = makeEntry({ id: 101, hours: 8, ...clock, user: person(30, 'Marcus Quinata') })
    const overtime = makeEntry({
      id: 102,
      hours: 10,
      ...clock,
      overtime_status: 'pending',
      pending_overtime_hours: 6,
      approval_reasons: [{ key: 'unscheduled_clock', label: 'Unscheduled clock' }, { key: 'overtime', label: 'Overtime' }],
      user: person(31, 'Ethan Cruz'),
    })
    const ownA = makeEntry({ id: 103, hours: 4, ...clock, user: person(20, 'Roke Aguon') })
    const ownB = makeEntry({ id: 104, hours: 4, ...clock, user: person(20, 'Roke Aguon') })
    const added = makeEntry({ id: 105, hours: 3, user: person(32, 'Tomas Flores') })
    const edited = makeEntry({ id: 106, hours: 5, ...clock, approval_reasons: [{ key: 'corrected_clock_out', label: 'Corrected clock-out' }], user: person(33, 'Grace Torres') })
    const pending = [ordinary, overtime, ownA, ownB, added, edited]
    apiMock.getPendingApprovals.mockResolvedValue({ data: { pending_entries: pending, count: pending.length } })
    apiMock.bulkApproveTimeEntries.mockResolvedValue({ data: { time_entries: pending, count: pending.length } })
    render(<ApprovalQueue canManageTeamTime approvalGroups={[]} approvalGroupsLoaded />)

    fireEvent.click(await screen.findByRole('button', { name: 'Select approvable (6)' }))
    fireEvent.click(screen.getByRole('button', { name: 'Approve Selected (6)' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Approve 6 selected entries?' })
    expect(dialog).toHaveAccessibleDescription(startsWith('Includes 6.00h overtime for Ethan Cruz, 2 of your own shifts, 1 shift added by hand and 1 edited shift.'))
    expect(dialog).toHaveTextContent('34.00h')
    const overtimeCallout = within(dialog).getByTestId('bulk-confirm-overtime')
    expect(overtimeCallout).toHaveTextContent('Includes 6.00h overtime. Approving these entries approves it too.')
    expect(overtimeCallout).toHaveTextContent('Ethan Cruz6.00h OT')
    const alsoIncluded = within(dialog).getByTestId('bulk-confirm-included')
    expect(within(alsoIncluded).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      '2 of your own shifts',
      '1 shift added by hand',
      '1 edited shift',
    ])
    expect(apiMock.bulkApproveTimeEntries).not.toHaveBeenCalled()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Approve 6 entries + 6.00h OT' }))
    await waitFor(() => expect(apiMock.bulkApproveTimeEntries).toHaveBeenCalledWith([101, 102, 103, 104, 105, 106]))
  })

  it('names each person with overtime and counts late shifts in the bulk summary', async () => {
    const clock = { entry_method: 'clock' as const, clock_source: 'kiosk' as const, approval_reasons: [{ key: 'overtime', label: 'Overtime' }] }
    const ethan = makeEntry({ id: 201, ...clock, overtime_status: 'pending', pending_overtime_hours: 2.5, user: { ...entries[0].user, id: 31, full_name: 'Ethan Cruz', display_name: 'Ethan Cruz' } })
    const overtimeOnly = makeEntry({ ...entries[1], id: 202, ...clock, approval_status: 'approved', overtime_status: 'pending', pending_overtime_hours: 1.5, payroll_cutoff_missed: true })
    apiMock.getPendingApprovals.mockResolvedValue({ data: { pending_entries: [ethan, overtimeOnly], count: 2 } })
    render(<ApprovalQueue canManageTeamTime approvalGroups={[]} approvalGroupsLoaded />)

    fireEvent.click(await screen.findByRole('button', { name: 'Select approvable (2)' }))
    fireEvent.click(screen.getByRole('button', { name: 'Approve Selected (2)' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Approve 2 selected entries?' })
    expect(dialog).toHaveAccessibleDescription(startsWith('Includes 4.00h overtime for Ethan Cruz and Zion Quintanilla and 1 shift that missed the payroll cutoff.'))
    expect(within(dialog).getByTestId('bulk-confirm-overtime')).toHaveTextContent('Ethan Cruz2.50h OTZion Quintanilla1.50h OT')
    expect(within(dialog).queryByTestId('bulk-confirm-included')).not.toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Approve 2 entries + 4.00h OT' })).toBeInTheDocument()
  })

  it('lists at most four people with overtime and sums the rest', async () => {
    const people = ['Ana Reyes', 'Ben Cruz', 'Cora Diaz', 'Dan Flores', 'Eve Garcia', 'Fay Hall']
    const pending = people.map((name, index) => makeEntry({
      id: 300 + index,
      entry_method: 'clock',
      clock_source: 'mobile',
      overtime_status: 'pending',
      pending_overtime_hours: 6 - index,
      approval_reasons: [{ key: 'overtime', label: 'Overtime' }],
      user: { ...entries[0].user, id: 400 + index, full_name: name, display_name: name },
    }))
    apiMock.getPendingApprovals.mockResolvedValue({ data: { pending_entries: pending, count: pending.length } })
    render(<ApprovalQueue canManageTeamTime approvalGroups={[]} approvalGroupsLoaded />)

    fireEvent.click(await screen.findByRole('button', { name: 'Select approvable (6)' }))
    fireEvent.click(screen.getByRole('button', { name: 'Approve Selected (6)' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Approve 6 selected entries?' })
    expect(dialog).toHaveAccessibleDescription(startsWith('Includes 21.00h overtime for 6 people.'))
    const rows = within(within(dialog).getByTestId('bulk-confirm-overtime')).getAllByRole('listitem').map((item) => item.textContent)
    expect(rows).toEqual(['Ana Reyes6.00h OT', 'Ben Cruz5.00h OT', 'Cora Diaz4.00h OT', 'Dan Flores3.00h OT', '+ 2 more people3.00h OT'])
  })

  it('keeps the bulk confirm plain when only ordinary clock shifts are selected', async () => {
    authMock.currentUser = { id: 20 }
    const ordinary = makeEntry({ entry_method: 'clock', clock_source: 'mobile', approval_reasons: [{ key: 'unscheduled_clock', label: 'Unscheduled clock' }] })
    apiMock.getPendingApprovals.mockResolvedValue({ data: { pending_entries: [ordinary], count: 1 } })
    render(<ApprovalQueue canManageTeamTime approvalGroups={[]} approvalGroupsLoaded />)

    fireEvent.click(await screen.findByRole('button', { name: 'Select approvable (1)' }))
    fireEvent.click(screen.getByRole('button', { name: 'Approve Selected (1)' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Approve 1 selected entry?' })
    expect(dialog).not.toHaveTextContent('Includes')
    expect(dialog).not.toHaveTextContent('overtime')
    expect(within(dialog).queryByTestId('bulk-confirm-included')).not.toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Approve 1 entry' })).toBeInTheDocument()
  })

  it('warns in bulk confirmation and still sends exactly the selected entries', async () => {
    const late = makeEntry({ payroll_cutoff_missed: true })
    const current = makeEntry({ id: 2, payroll_cutoff_missed: false })
    apiMock.getPendingApprovals.mockResolvedValue({ data: { pending_entries: [late, current], count: 2 } })
    apiMock.bulkApproveTimeEntries.mockResolvedValue({ data: { time_entries: [late, current], count: 2 } })
    render(<ApprovalQueue canManageTeamTime approvalGroups={[]} approvalGroupsLoaded />)
    fireEvent.click(await screen.findByRole('button', { name: 'Select approvable (2)' }))
    fireEvent.click(screen.getByRole('button', { name: 'Approve Selected (2)' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Approve 2 selected entries?' })
    expect(dialog).toHaveTextContent('1 selected entry has missed the payroll cutoff.')
    expect(dialog).toHaveTextContent(LATE_HOURS_NOTICE)
    expect(apiMock.bulkApproveTimeEntries).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Approve 2 entries' }))
    await waitFor(() => expect(apiMock.bulkApproveTimeEntries).toHaveBeenCalledWith([late.id, current.id]))
  })
})


it('keeps note entry and approval usable with a long entry', async () => {
  vi.clearAllMocks()
  localStorage.clear()
  const source = makeEntry({ description: 'Synthetic long shift description. '.repeat(20) })
  apiMock.getTimeCategories.mockResolvedValue({ data: { time_categories: categories } })
  apiMock.getPendingApprovals.mockResolvedValue({ data: { pending_entries: [source], count: 1 } })
  apiMock.approveTimeEntry.mockResolvedValue({ data: { time_entry: { ...source, approval_status: 'approved' } } })
  render(<ApprovalQueue canManageTeamTime approvalGroups={[]} approvalGroupsLoaded />)
  fireEvent.click(await screen.findByRole('button', { name: 'Add note' }))
  fireEvent.change(screen.getByPlaceholderText('Add a note (optional)...'), { target: { value: 'Synthetic review note' } })
  expect(screen.getByRole('button', { name: 'Deny' })).toBeEnabled()
  expect(screen.getByRole('button', { name: 'Edit entry' })).toBeEnabled()
  fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
  await waitFor(() => expect(apiMock.approveTimeEntry).toHaveBeenCalledWith(source.id, 'Synthetic review note'))
})
