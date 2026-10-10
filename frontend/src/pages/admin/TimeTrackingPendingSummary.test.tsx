import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TimeTracking from './TimeTracking'
import type { PendingApprovalsResponse, PendingApprovalsSummary } from '../../lib/api'

const apiMock = vi.hoisted(() => ({
  getTimeEntries: vi.fn(), getTimeCategories: vi.fn(), getUsers: vi.fn(),
  getCurrentUser: vi.fn(), getAdminAppSettings: vi.fn(), getPendingApprovals: vi.fn(),
}))
vi.mock('../../lib/api', () => ({ api: apiMock }))
vi.mock('../../contexts/AuthContext', () => ({ useAuthContext: () => ({ isClerkEnabled: true, userRole: 'admin' }) }))
vi.mock('../../components/time-tracking/WhosWorking', () => ({ default: () => null }))
vi.mock('../../components/time-tracking/ClockInOutCard', () => ({
  default: ({ onStatusChange }: { onStatusChange: () => void }) => <button onClick={onStatusChange}>Refresh saved entry</button>,
}))

function summary(entryCount: number): PendingApprovalsSummary {
  return {
    total_hours: entryCount * 4, entry_count: entryCount,
    oldest_work_date: '2026-11-01', newest_work_date: '2026-11-01',
    pending_time_entry_count: entryCount, pending_overtime_count: 1,
    manual_count: entryCount, clock_count: 0, counts_by_date: [],
  }
}

function deferredResponse() {
  let resolve!: (response: { data: PendingApprovalsResponse }) => void
  const promise = new Promise<{ data: PendingApprovalsResponse }>(done => { resolve = done })
  return { promise, resolve }
}

function openPage() {
  return render(<MemoryRouter initialEntries={['/admin/time?date=2026-11-01&view=day']}><TimeTracking /></MemoryRouter>)
}

describe('TimeTracking pending approval summary requests', () => {
  beforeEach(() => {
    Object.values(apiMock).forEach(mock => mock.mockReset())
    apiMock.getTimeEntries.mockResolvedValue({ data: { time_entries: [] } })
    apiMock.getTimeCategories.mockResolvedValue({ data: { time_categories: [] } })
    apiMock.getUsers.mockResolvedValue({ data: { users: [] } })
    apiMock.getCurrentUser.mockResolvedValue({ data: { user: { id: 1, is_admin: true } } })
    apiMock.getAdminAppSettings.mockResolvedValue({ data: { approval_groups: [] } })
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  })
  afterEach(() => { cleanup(); vi.restoreAllMocks() })

  it.each(['saved entry refresh', 'visibility polling'])('retains the newer count after %s when an older response arrives last', async trigger => {
    const older = deferredResponse()
    apiMock.getPendingApprovals.mockReturnValueOnce(older.promise)
      .mockResolvedValueOnce({ data: { pending_entries: [], count: 2, summary: summary(2) } })
    openPage()
    await waitFor(() => expect(apiMock.getPendingApprovals).toHaveBeenCalledTimes(1))

    if (trigger === 'saved entry refresh') fireEvent.click(screen.getByRole('button', { name: 'Refresh saved entry' }))
    else fireEvent(document, new Event('visibilitychange'))
    expect(await screen.findByRole('button', { name: 'Approvals, 2 pending' })).toBeVisible()

    await act(async () => older.resolve({ data: { pending_entries: [], count: 9, summary: summary(9) } }))
    expect(screen.getByRole('button', { name: 'Approvals, 2 pending' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Approvals, 9 pending' })).not.toBeInTheDocument()
  })

  it('does not consume a pending summary response or poll again after unmount', async () => {
    const pending = deferredResponse()
    const readSummary = vi.fn(() => summary(9))
    apiMock.getPendingApprovals.mockReturnValueOnce(pending.promise)
    const page = openPage()
    await waitFor(() => expect(apiMock.getPendingApprovals).toHaveBeenCalledTimes(1))
    page.unmount()

    await act(async () => pending.resolve({ data: { pending_entries: [], count: 9, get summary() { return readSummary() } } }))
    fireEvent(document, new Event('visibilitychange'))
    expect(readSummary).not.toHaveBeenCalled()
    expect(apiMock.getPendingApprovals).toHaveBeenCalledTimes(1)
  })
})
