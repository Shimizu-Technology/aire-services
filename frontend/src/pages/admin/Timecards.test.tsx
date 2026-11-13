import '@testing-library/jest-dom'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../../components/ui'
import type { TimeEntry, UserSummary } from '../../lib/api'
import { mockMatchMedia } from '../../test/matchMedia'
import Timecards from './Timecards'

const apiMock = vi.hoisted(() => ({
  getTimeEntries: vi.fn(), getTimeEntry: vi.fn(), getUsers: vi.fn(), getWhosWorking: vi.fn(), getTimeCategories: vi.fn(),
  getPayrollCutoff: vi.fn(), getSchedule: vi.fn(), getHoursReport: vi.fn(), updateTimeEntry: vi.fn(), createTimeEntry: vi.fn(),
}))
vi.mock('../../lib/api', () => ({ api: apiMock }))
const auth = vi.hoisted(() => ({ isClerkEnabled: true, userRole: 'manager', currentUser: { id: 2 } }))
vi.mock('../../contexts/AuthContext', () => ({ useAuthContext: () => auth }))
vi.mock('../../components/time-tracking/PayrollCutoffNotice', () => ({ default: () => null }))

const user = (id: number, name: string, extra: Partial<UserSummary> = {}): UserSummary => ({
  id, email: `${name.split(' ')[0].toLowerCase()}@example.test`, first_name: name.split(' ')[0], last_name: name.split(' ')[1], display_name: name, full_name: name,
  role: 'employee', is_active: true, employment_status: 'active', approval_group_labels: ['Ops / Maintenance'], time_category_ids: [3], ...extra,
})
const USERS = [
  user(2, 'Roke Aguon', { role: 'manager' }),
  user(7, 'Caleb Perez'),
  user(9, 'Ethan Cruz', { approval_group_labels: ['CFI'] }),
  user(11, 'Kai Blas'),
  user(12, 'Old Timer', { employment_status: 'terminated', termination_effective_on: '2026-11-03' }),
]
const summaryRow = (id: number, hours: number, issues: Record<string, number> = {}) => ({
  id, total_hours: hours, overtime_hours: 0, entries_count: hours > 0 ? 2 : 0, days: [],
  issues: { pending_count: 0, denied_count: 0, pending_overtime_count: 0, denied_overtime_count: 0, open_clock_count: 0, uncategorized_count: 0, ...issues },
})

function entry(overrides: Partial<TimeEntry>): TimeEntry {
  return {
    id: 1, version: 1, work_date: '2026-11-02', start_time: '07:00', end_time: '15:38', formatted_start_time: '7:00 AM', formatted_end_time: '3:38 PM',
    hours: 8.63, break_minutes: 0, description: null, entry_method: 'clock', clock_source: 'kiosk', status: 'completed', admin_override: false,
    attendance_status: null, approval_status: 'approved', overtime_status: 'none', clock_in_at: '2026-11-02T07:00:00+10:00', clock_out_at: '2026-11-02T15:38:00+10:00',
    approved_by: null, approved_at: null, approval_note: null, overtime_approved_by: null, overtime_approved_at: null, overtime_note: null,
    schedule: null, breaks: [], time_category: { id: 3, name: 'Ground Operations' },
    user: { id: 7, email: 'caleb@example.test', display_name: 'Caleb Perez', full_name: 'Caleb Perez', time_category_ids: [3] },
    created_at: '2026-11-02T07:00:00+10:00', updated_at: '2026-11-02T15:38:00+10:00',
    ...overrides,
  }
}
const OPEN = entry({
  id: 55, version: 4, work_date: '2026-11-10', start_time: '07:02', end_time: null, formatted_start_time: '7:02 AM', formatted_end_time: null,
  hours: 0, status: 'clocked_in', approval_status: null, clock_in_at: '2026-11-10T07:02:00+10:00', clock_out_at: null,
})
const CALEB_ENTRIES = [
  entry({ id: 41 }),
  entry({ id: 42, work_date: '2026-11-09', approval_status: 'pending', hours: 9.12, formatted_end_time: '4:07 PM' }),
  OPEN,
]

function Probe() {
  const location = useLocation()
  const navigate = useNavigate()
  return <>
    <output data-testid="url">{location.search}</output>
    <button type="button" onClick={() => navigate(-1)}>Browser back</button>
  </>
}

function openAt(url: string) {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={[url]}>
        <Probe />
        <Routes><Route path="/admin/timecards" element={<Timecards />} /></Routes>
      </MemoryRouter>
    </ToastProvider>,
  )
}
const search = () => new URLSearchParams(screen.getByTestId('url').textContent ?? '')

let restoreMedia: () => void
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-12T09:00:00+10:00'))
  restoreMedia = mockMatchMedia({ width: 390 })
  Object.values(apiMock).forEach(mock => mock.mockReset())
  apiMock.getUsers.mockResolvedValue({ data: { users: USERS } })
  apiMock.getTimeCategories.mockResolvedValue({ data: { time_categories: [{ id: 3, name: 'Ground Operations', description: null }] } })
  apiMock.getPayrollCutoff.mockResolvedValue({ data: { cutoff: { period: { id: 1, start_date: '2026-11-01', end_date: '2026-11-15' }, cutoff_at: '2026-11-18T17:00:00+10:00' } } })
  apiMock.getWhosWorking.mockResolvedValue({ data: { workers: [{ user: { id: 7 }, status: 'clocked_in', open_since_work_date: '2026-11-10', open_entry_id: 55 }] } })
  apiMock.getHoursReport.mockImplementation(async (params: { user_id?: number }) => ({
    data: {
      summary_only: true,
      employees: [summaryRow(2, 0), summaryRow(7, 43.2, { open_clock_count: 1, pending_count: 1 }), summaryRow(9, 0), summaryRow(11, 66.5), summaryRow(12, 0)]
        .filter(row => !params.user_id || row.id === params.user_id),
    },
  }))
  apiMock.getTimeEntries.mockImplementation(async (params: { user_id?: number; start_date?: string }) => ({
    data: { time_entries: params.user_id === 7 && params.start_date === '2026-11-01' ? CALEB_ENTRIES : [], pagination: { total_pages: 1 } },
  }))
  apiMock.getTimeEntry.mockResolvedValue({ data: { time_entry: OPEN } })
})
afterEach(() => {
  restoreMedia()
  vi.useRealTimers()
})

describe('Timecards on a phone', () => {
  it('opens on "Needs a look" with the lock date, and a search looks through everyone', async () => {
    openAt('/admin/timecards')
    expect(await screen.findByRole('heading', { level: 1, name: 'Timecards' })).toBeInTheDocument()
    expect(await screen.findByText('Nov 1–15 · locks Wed, Nov 18')).toBeInTheDocument()
    const needs = await screen.findByRole('button', { name: /Needs a look/ })
    expect(needs).toHaveAttribute('aria-pressed', 'true')
    expect(needs).toHaveTextContent('1')
    const people = await screen.findByRole('list', { name: 'People' })
    expect(within(people).getByText('Caleb Perez')).toBeInTheDocument()
    expect(within(people).getByText('Still clocked in')).toBeInTheDocument()
    expect(within(people).queryByText('Kai Blas')).not.toBeInTheDocument()

    fireEvent.change(screen.getByRole('searchbox', { name: 'Find a person' }), { target: { value: 'kai' } })
    expect(within(screen.getByRole('list', { name: 'People' })).getByText('Kai Blas')).toBeInTheDocument()
    expect(within(screen.getByRole('list', { name: 'People' })).getByText(/66\.5h approved/)).toBeInTheDocument()
  })

  it('shows every day of the period, the forgotten clock, and the days still to come', async () => {
    openAt('/admin/timecards')
    fireEvent.click(await screen.findByText('Caleb Perez'))
    expect(search().get('user_id')).toBe('7')
    expect(search().get('period')).toBe('2026-11-01')

    const days = await screen.findByRole('list', { name: 'Days in Nov 1–15' })
    expect(within(days).getAllByRole('article')).toHaveLength(12)
    expect(within(days).getByRole('article', { name: 'Sunday, November 1' })).toHaveTextContent('Day off')
    expect(within(days).getByRole('article', { name: 'Thursday, November 12' })).toHaveTextContent('No time yet today')
    expect(within(days).getByRole('article', { name: 'Tuesday, November 10' })).toHaveTextContent('7:02a – no clock-out')
    expect(screen.getByText('Nov 13–15 haven\'t happened yet')).toBeInTheDocument()
    expect(screen.getByText(/Still clocked in from Tue, Nov 10\. Fix it before the lock on Wed, Nov 18\./)).toBeInTheDocument()
    const summary = screen.getByText('Approved', { selector: 'dt' }).closest('dl')!
    expect(summary).toHaveTextContent('Approved43.2h')
    expect(summary).toHaveTextContent('Waiting9.1h')
    expect(summary).toHaveTextContent('Overtime—')

    fireEvent.click(screen.getByRole('link', { name: 'Timecards' }))
    expect(search().get('user_id')).toBeNull()
    expect(search().get('period')).toBe('2026-11-01')
  })

  it('keeps the period in the URL as it steps, and Back returns to it', async () => {
    openAt('/admin/timecards?user_id=7&period=2026-11-01')
    expect(await screen.findByRole('list', { name: 'Days in Nov 1–15' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next pay period' })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'Previous pay period' }))
    expect(search().get('period')).toBe('2026-10-16')
    expect(search().get('user_id')).toBe('7')
    await waitFor(() => expect(apiMock.getTimeEntries).toHaveBeenCalledWith(expect.objectContaining({ user_id: 7, start_date: '2026-10-16', end_date: '2026-10-31' })))
    expect(await screen.findByText('No time recorded for Caleb in Oct 16–31.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Browser back' }))
    expect(search().get('period')).toBe('2026-11-01')
    expect(await screen.findByRole('list', { name: 'Days in Nov 1–15' })).toBeInTheDocument()
  })

  it.each([
    ["Who's Working", '/admin/timecards?entry_id=55&date=2026-11-10&view=day&user_id=7'],
    ['Today (the same Fix clock-out link, from its Who\'s Working card)', '/admin/timecards?entry_id=55&date=2026-11-10&view=day&user_id=7'],
  ])('opens the Fix clock-out link from %s on the right person, period and shift', async (_from, url) => {
    openAt(url)
    const fix = await screen.findByRole('form', { name: 'Fix clock-out · Tue, Nov 10' })
    expect(within(fix).getByLabelText(/Clocked out/)).toHaveFocus()
    expect(screen.getByRole('heading', { level: 2, name: 'Caleb Perez' })).toBeInTheDocument()
    expect(search().get('period')).toBe('2026-11-01')
  })

  it('finds the person and period from the shift when a link only names the shift', async () => {
    openAt('/admin/timecards?entry_id=55')
    await waitFor(() => expect(search().get('user_id')).toBe('7'))
    expect(search().get('period')).toBe('2026-11-01')
    expect(await screen.findByRole('form', { name: /Fix clock-out/ })).toBeInTheDocument()
  })

  it('says so when a linked shift belongs to someone else', async () => {
    openAt('/admin/timecards?entry_id=55&user_id=9')
    expect(await screen.findByText("The linked shift isn't on this person's timecard.")).toBeInTheDocument()
    expect(search().get('user_id')).toBe('9')
  })

  it('logs missed time for the timecard’s person, never the signed-in manager', async () => {
    apiMock.createTimeEntry.mockResolvedValue({ data: { time_entry: { id: 300 } } })
    openAt('/admin/timecards?user_id=7&period=2026-11-01')
    fireEvent.click(await screen.findByRole('button', { name: 'Log missed time for Caleb' }))
    const sheet = screen.getByRole('dialog', { name: 'Log missed time' })
    expect(within(sheet).getByRole('button', { name: /Who worked/ })).toHaveTextContent('Caleb Perez')
    fireEvent.change(within(sheet).getByLabelText(/^Day/), { target: { value: '2026-11-11' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Add 8.0h for Caleb' })) })
    expect(apiMock.createTimeEntry).toHaveBeenCalledWith(expect.objectContaining({ user_id: 7, work_date: '2026-11-11' }))
    expect(apiMock.createTimeEntry).not.toHaveBeenCalledWith(expect.objectContaining({ user_id: 2 }))
    expect(await screen.findByText("Added 8.0h for Caleb. It's waiting in Approvals.")).toBeInTheDocument()
  })

  it('shows a former employee read-only', async () => {
    apiMock.getTimeEntries.mockResolvedValue({ data: { time_entries: [entry({ id: 80, user: { ...OPEN.user, id: 12 } }), entry({ ...OPEN, id: 81, user: { ...OPEN.user, id: 12 } })], pagination: { total_pages: 1 } } })
    openAt('/admin/timecards?user_id=12&period=2026-11-01')
    expect(await screen.findByText('Employment ended Nov 3. This timecard is read-only.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Fix clock-out' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Log missed time/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Edit shift/ })).not.toBeInTheDocument()
  })

  it('reads an old period link (?view=period&start_date=)', async () => {
    openAt('/admin/timecards?view=period&start_date=2026-10-16&end_date=2026-10-31')
    expect(await screen.findByText(/^Oct 16–31/)).toBeInTheDocument()
    await waitFor(() => expect(apiMock.getHoursReport).toHaveBeenCalledWith(expect.objectContaining({ start_date: '2026-10-16', end_date: '2026-10-31', summary_only: 1 })))
  })
})

describe('Timecards on a desktop', () => {
  beforeEach(() => { restoreMedia(); restoreMedia = mockMatchMedia({ width: 1280 }) })

  it('shows the people beside the timecard, and Everyone shows the week grid', async () => {
    openAt('/admin/timecards')
    expect(await screen.findByText('Pick a person to see their pay period.')).toBeInTheDocument()
    expect(await screen.findByRole('list', { name: 'People' })).toBeInTheDocument()

    fireEvent.click(within(screen.getByRole('list', { name: 'People' })).getByText('Caleb Perez'))
    expect(await screen.findByRole('heading', { level: 2, name: 'Caleb Perez' })).toBeInTheDocument()
    expect(screen.getByRole('list', { name: 'People' })).toBeInTheDocument()
    // On desktop the header holds Log missed time, not the timecard.
    expect(screen.queryByRole('button', { name: 'Log missed time for Caleb' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: 'Everyone' }))
    expect(search().get('view')).toBe('everyone')
    await waitFor(() => expect(apiMock.getTimeEntries).toHaveBeenCalledWith(expect.objectContaining({ week: '2026-11-08' })))
    expect(await screen.findByRole('region', { name: "Everyone's week" })).toHaveTextContent('Nov 8 – Nov 14, 2026')

    fireEvent.click(screen.getByRole('button', { name: 'Browser back' }))
    expect(search().get('user_id')).toBe('7')
    expect(search().get('period')).toBe('2026-11-01')
  })

  it('opens Log missed time from the header with nobody chosen in Everyone', async () => {
    openAt('/admin/timecards?view=everyone')
    fireEvent.click(await screen.findByRole('button', { name: 'Log missed time' }))
    expect(within(screen.getByRole('dialog', { name: 'Log missed time' })).getByRole('combobox', { name: 'Who worked' })).toHaveValue('')
    expect(screen.getByRole('button', { name: 'Add shift' })).toBeDisabled()
  })
})
