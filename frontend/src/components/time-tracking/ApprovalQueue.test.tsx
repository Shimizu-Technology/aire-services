import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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
    locked_at: null,
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
})
