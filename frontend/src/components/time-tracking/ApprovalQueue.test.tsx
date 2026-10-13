import '@testing-library/jest-dom'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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
    apiMock.getPendingApprovals.mockResolvedValue({ data: { pending_entries: entries, count: entries.length, summary } })
    apiMock.getTimeCategories.mockResolvedValue({ data: { time_categories: categories } })
  })

  it.each([true, false])('passes the admin role (%s) to the denied overtime editor', async (isAdmin) => {
    const denied = makeEntry({ version: 7, approval_status: 'denied', overtime_status: 'pending' })
    apiMock.getPendingApprovals.mockResolvedValue({ data: { pending_entries: [denied], count: 1, summary } })
    render(<ApprovalQueue approvalGroups={[]} approvalGroupsLoaded isAdmin={isAdmin} canDeleteEntry={() => true} />)
    fireEvent.click(await screen.findByTitle('Edit entry'))
    const dialog = screen.getByRole('dialog', { name: 'Edit Time Entry' })
    expect(within(dialog).getByLabelText('End Time *')).toHaveValue('10:00')
    const resubmit = within(dialog).queryByRole('checkbox', { name: 'Submit denied time for review' })
    if (isAdmin) expect(resubmit).toBeVisible()
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
