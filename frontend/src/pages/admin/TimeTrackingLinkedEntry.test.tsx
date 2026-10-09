import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TimeTracking from './TimeTracking'
import type { TimeEntry } from '../../lib/api'

const apiMock = vi.hoisted(() => ({
  getTimeEntry: vi.fn(), getTimeEntries: vi.fn(), getTimeCategories: vi.fn(), getUsers: vi.fn(),
  getCurrentUser: vi.fn(), getAdminAppSettings: vi.fn(), getPendingApprovals: vi.fn(), getHoursReport: vi.fn(),
  updateTimeEntry: vi.fn(), deleteTimeEntry: vi.fn(), approveTimeEntry: vi.fn(),
}))
vi.mock('../../lib/api', () => ({ api: apiMock }))
vi.mock('../../contexts/AuthContext', () => ({ useAuthContext: () => ({ isClerkEnabled: true, userRole: 'admin' }) }))
vi.mock('../../components/time-tracking/ClockInOutCard', () => ({ default: () => null }))
vi.mock('../../components/time-tracking/WhosWorking', () => ({ default: () => null }))

function Harness() {
  const location = useLocation()
  const navigate = useNavigate()
  return <>
    <button onClick={() => navigate('/admin/time?entry_id=91&user_id=8&date=2026-11-02&view=day')}>Open other employee</button>
    <output data-testid="search">{location.search}</output>
    <TimeTracking />
  </>
}

function makeEntry(overrides: Partial<TimeEntry> = {}): TimeEntry {
  return {
    id: 90, version: 0, work_date: '2026-11-01', hours: 0, start_time: '08:00', end_time: null,
    formatted_start_time: '8:00 AM', formatted_end_time: null, break_minutes: 0, description: 'Historical clock',
    entry_method: 'clock', clock_source: 'mobile', status: 'clocked_in', admin_override: false,
    attendance_status: null, approval_status: null, overtime_status: 'none',
    clock_in_at: '2026-11-01T08:00:00+10:00', clock_out_at: null,
    approved_by: null, approved_at: null, approval_note: null,
    overtime_approved_by: null, overtime_approved_at: null, overtime_note: null, schedule: null, breaks: [],
    user: { id: 7, email: 'casey@example.test', display_name: 'Casey', full_name: 'Casey', time_category_ids: [3] },
    time_category: { id: 3, name: 'Operations' }, created_at: '2026-11-01T08:00:00+10:00', updated_at: '2026-11-01T08:00:00+10:00',
    ...overrides,
  }
}
const completed = () => makeEntry({ version: 1, status: 'completed', hours: 4, end_time: '12:00', formatted_end_time: '12:00 PM',
  approval_status: 'pending', clock_out_at: '2026-11-01T12:00:00+10:00' })
const otherEntry = () => makeEntry({ id: 91, version: 2, hours: 6, status: 'completed', work_date: '2026-11-02',
  end_time: '14:00', formatted_end_time: '2:00 PM', description: 'Other employee source',
  user: { id: 8, email: 'other@example.test', display_name: 'Other employee', full_name: 'Other employee', time_category_ids: [3] } })
const initialRoute = '/admin/time?entry_id=90&user_id=7&date=2026-11-01&view=day&return_to=%2Fadmin%2Fusers%2F7%3Ftab%3Dhours'
function openPage(route = initialRoute) {
  return render(<MemoryRouter initialEntries={[route]}><Harness /></MemoryRouter>)
}
function setSavedEntry(entry: TimeEntry) {
  apiMock.getTimeEntry.mockResolvedValue({ data: { time_entry: entry } })
  apiMock.getTimeEntries.mockResolvedValue({ data: { time_entries: [entry] } })
}
async function endClock() {
  fireEvent.click(await screen.findByTitle('Edit entry'))
  const dialog = screen.getByRole('dialog', { name: 'Edit Time Entry' })
  fireEvent.click(within(dialog).getByRole('checkbox', { name: 'End this clock' }))
  fireEvent.change(within(dialog).getByLabelText('Clock-out time (Guam) *'), { target: { value: '12:00' } })
  fireEvent.change(within(dialog).getByLabelText('Correction reason *'), { target: { value: 'Actual historical stop confirmed' } })
  fireEvent.click(within(dialog).getByRole('button', { name: 'End clock and submit' }))
}
function dayCard(id = 90) {
  const card = document.getElementById(`time-entry-${id}`)
  expect(card).not.toBeNull()
  return within(card!)
}

describe('TimeTracking current linked entry refresh', () => {
  beforeEach(() => {
    Object.values(apiMock).forEach(mock => mock.mockReset())
    setSavedEntry(makeEntry())
    apiMock.getTimeCategories.mockResolvedValue({ data: { time_categories: [{ id: 3, name: 'Operations' }] } })
    apiMock.getUsers.mockResolvedValue({ data: { users: [makeEntry().user, otherEntry().user].map(user => ({ ...user, role: 'employee', is_active: true, employment_status: 'active' })) } })
    apiMock.getCurrentUser.mockResolvedValue({ data: { user: { id: 1, is_admin: true } } })
    apiMock.getAdminAppSettings.mockResolvedValue({ data: { approval_groups: [] } })
    apiMock.getPendingApprovals.mockResolvedValue({ data: { pending_entries: [], count: 0, summary: null } })
    apiMock.getHoursReport.mockResolvedValue({ error: 'No report requested' })
  })
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

  it('refreshes 0h to 4h in both current summary and day card without losing filters or return context', async () => {
    apiMock.updateTimeEntry.mockImplementation(async () => { setSavedEntry(completed()); return { data: { time_entry: completed() } } })
    openPage()
    expect(await screen.findByRole('region', { name: 'Linked time entry' })).toHaveTextContent('0.00h')
    expect(dayCard().getByText('0h')).toBeInTheDocument()
    fireEvent.change(await screen.findByDisplayValue('All Categories'), { target: { value: '3' } })
    await waitFor(() => expect(apiMock.getTimeEntries).toHaveBeenLastCalledWith(expect.objectContaining({ user_id: 7, time_category_id: 3 })))
    const searchBefore = screen.getByTestId('search').textContent
    await endClock()
    await waitFor(() => expect(screen.getByRole('region', { name: 'Linked time entry' })).toHaveTextContent('4.00h · Operations · pending'))
    expect(dayCard().getByText('4h')).toBeInTheDocument()
    expect(dayCard().getByText('Pending')).toBeInTheDocument()
    expect(apiMock.getTimeEntry).toHaveBeenCalledTimes(2)
    expect(apiMock.getTimeEntries).toHaveBeenLastCalledWith({ user_id: 7, time_category_id: 3, date: '2026-11-01', per_page: 100, page: 1 })
    expect(screen.getByTestId('search').textContent).toBe(searchBefore)
    expect(screen.getByRole('link', { name: 'Back to employee review' })).toHaveAttribute('href', '/admin/users/7?tab=hours')
  })

  it('ignores an older linked response that arrives after the saved version refresh', async () => {
    let finishOld!: (response: unknown) => void
    apiMock.getTimeEntry.mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve }))
    apiMock.updateTimeEntry.mockImplementation(async () => { setSavedEntry(completed()); return { data: { time_entry: completed() } } })
    openPage()
    await endClock()
    expect(await screen.findByRole('region', { name: 'Linked time entry' })).toHaveTextContent('4.00h')
    await act(async () => finishOld({ data: { time_entry: makeEntry() } }))
    expect(screen.getByRole('region', { name: 'Linked time entry' })).toHaveTextContent('4.00h')
    expect(dayCard().getByText('4h')).toBeInTheDocument()
  })

  it('refreshes current approval status after the existing separate approval action', async () => {
    setSavedEntry(completed())
    apiMock.getPendingApprovals.mockResolvedValue({ data: { pending_entries: [completed()], count: 1, summary: null } })
    apiMock.approveTimeEntry.mockImplementation(async () => {
      const approved = completed(); approved.approval_status = 'approved'; approved.version = 2
      setSavedEntry(approved)
      apiMock.getPendingApprovals.mockResolvedValue({ data: { pending_entries: [], count: 0, summary: null } })
      return { data: { time_entry: approved } }
    })
    openPage()
    expect(await screen.findByRole('region', { name: 'Linked time entry' })).toHaveTextContent('pending')
    fireEvent.click(screen.getByRole('button', { name: /^Approvals/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }))
    await waitFor(() => expect(apiMock.getTimeEntry).toHaveBeenCalledTimes(2))
    fireEvent.click(screen.getByRole('button', { name: 'Time Entries' }))
    expect(await screen.findByRole('region', { name: 'Linked time entry' })).toHaveTextContent('4.00h · Operations · approved')
    expect(dayCard().getByText('4h')).toBeInTheDocument()
    expect(dayCard().queryByText('Pending')).not.toBeInTheDocument()
    expect(apiMock.approveTimeEntry).toHaveBeenCalledWith(90, undefined)
  })

  it('removes the current linked snapshot and card after deletion while retaining the route context', async () => {
    vi.stubGlobal('confirm', vi.fn(() => true))
    setSavedEntry(completed())
    apiMock.deleteTimeEntry.mockImplementation(async () => {
      apiMock.getTimeEntry.mockResolvedValue({ error: 'Time entry not found' })
      apiMock.getTimeEntries.mockResolvedValue({ data: { time_entries: [] } })
      return {}
    })
    openPage()
    await screen.findByRole('region', { name: 'Linked time entry' })
    const searchBefore = screen.getByTestId('search').textContent
    fireEvent.click(screen.getByTitle('Delete entry'))
    expect(await screen.findByText('Time entry not found')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Linked time entry' })).not.toBeInTheDocument()
    expect(document.getElementById('time-entry-90')).toBeNull()
    expect(await screen.findByText('No time entries for this day')).toBeInTheDocument()
    expect(screen.getByTestId('search').textContent).toBe(searchBefore)
  })

  it('does not let late old employee requests replace the new linked context or cards', async () => {
    let finishOldEntry!: (response: unknown) => void
    let finishOldCards!: (response: unknown) => void
    apiMock.getTimeEntry.mockImplementation(id => id === 90 ? new Promise(resolve => { finishOldEntry = resolve }) : Promise.resolve({ data: { time_entry: otherEntry() } }))
    apiMock.getTimeEntries.mockImplementation(params => params.user_id === 7 ? new Promise(resolve => { finishOldCards = resolve }) : Promise.resolve({ data: { time_entries: [otherEntry()] } }))
    openPage()
    await waitFor(() => expect(finishOldCards).toBeDefined())
    fireEvent.click(screen.getByRole('button', { name: 'Open other employee' }))
    expect(await screen.findByRole('region', { name: 'Linked time entry' })).toHaveTextContent('Entry #91')
    await waitFor(() => expect(dayCard(91).getByText('6h')).toBeInTheDocument())
    await act(async () => {
      finishOldEntry({ data: { time_entry: makeEntry() } })
      finishOldCards({ data: { time_entries: [makeEntry()] } })
    })
    expect(screen.getByRole('region', { name: 'Linked time entry' })).toHaveTextContent('6.00h')
    expect(document.getElementById('time-entry-90')).toBeNull()
    expect(dayCard(91).getByText('6h')).toBeInTheDocument()
  })

  it('uses the new employee scope when an old employee mutation finishes after navigation', async () => {
    let finishWrite!: (response: unknown) => void
    apiMock.getTimeEntry.mockImplementation(id => Promise.resolve({ data: { time_entry: id === 90 ? makeEntry() : otherEntry() } }))
    apiMock.getTimeEntries.mockImplementation(params => Promise.resolve({ data: { time_entries: [params.user_id === 7 ? makeEntry() : otherEntry()] } }))
    apiMock.updateTimeEntry.mockImplementationOnce(() => new Promise(resolve => { finishWrite = resolve }))
    openPage()
    await endClock()
    await waitFor(() => expect(finishWrite).toBeDefined())
    fireEvent.click(screen.getByRole('button', { name: 'Open other employee' }))
    await waitFor(() => expect(apiMock.getTimeEntries).toHaveBeenLastCalledWith(expect.objectContaining({ user_id: 8, date: '2026-11-02' })))
    const callsAfterNavigation = apiMock.getTimeEntries.mock.calls.length
    await act(async () => finishWrite({ data: { time_entry: completed() } }))
    await waitFor(() => expect(apiMock.getTimeEntries.mock.calls.length).toBeGreaterThan(callsAfterNavigation))
    expect(apiMock.getTimeEntries.mock.calls.slice(callsAfterNavigation).every(([params]) => params.user_id === 8 && params.date === '2026-11-02')).toBe(true)
    expect(await screen.findByRole('region', { name: 'Linked time entry' })).toHaveTextContent('Entry #91')
    expect(dayCard(91).getByText('6h')).toBeInTheDocument()
    expect(document.getElementById('time-entry-90')).toBeNull()
  })
})
