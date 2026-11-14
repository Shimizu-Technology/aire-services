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
// A report shift: the person's own report row lists each counted shift and the ones left out.
const reportShift = (id: number, hours: number, overrides: Record<string, unknown> = {}) => ({
  id, work_date: '2026-11-02', total_hours: hours, overtime_hours: 0, overtime_status: 'none', approval_status: 'approved', entry_method: 'clock', quality_flags: [], ...overrides,
})
const summaryRow = (id: number, hours: number, issues: Record<string, number> = {}, excluded: ReturnType<typeof reportShift>[] = []) => ({
  id, total_hours: hours, overtime_hours: 0, entries_count: hours > 0 ? 2 : 0,
  days: hours > 0 ? [{ work_date: '2026-11-02', entries: [reportShift(900 + id, hours)] }] : [],
  excluded_entries: excluded,
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
      employees: [summaryRow(2, 0), summaryRow(7, 43.2, { open_clock_count: 1, pending_count: 1 }, [reportShift(42, 9.12, { work_date: '2026-11-09', approval_status: 'pending' })]), summaryRow(9, 0), summaryRow(11, 66.5), summaryRow(12, 0)]
        .filter(row => !params.user_id || row.id === params.user_id),
    },
  }))
  apiMock.getTimeEntries.mockImplementation(async (params: { user_id?: number; start_date?: string; end_date?: string }) => ({
    data: { time_entries: params.user_id === 7 && params.end_date === '2026-11-15' ? CALEB_ENTRIES : [], pagination: { total_pages: 1 } },
  }))
  apiMock.getTimeEntry.mockResolvedValue({ data: { time_entry: OPEN } })
})
afterEach(() => {
  restoreMedia()
  vi.useRealTimers()
})

describe('Timecards on a phone', () => {
  it('opens on "People to check" with the lock date, and a search looks through everyone', async () => {
    openAt('/admin/timecards')
    expect(await screen.findByRole('heading', { level: 1, name: 'Timecards' })).toBeInTheDocument()
    expect(await screen.findByText('Nov 1–15 · locks Wed, Nov 18')).toBeInTheDocument()
    const needs = await screen.findByRole('button', { name: /People to check/ })
    expect(needs).toHaveAttribute('aria-pressed', 'true')
    expect(needs).toHaveTextContent('1')
    const people = await screen.findByRole('list', { name: 'People' })
    expect(within(people).getByText('Caleb Perez')).toBeInTheDocument()
    expect(within(people).getByText('Still clocked in')).toBeInTheDocument()
    expect(within(people).queryByText('Kai Blas')).not.toBeInTheDocument()

    fireEvent.change(screen.getByRole('searchbox', { name: 'Find a person' }), { target: { value: 'kai' } })
    expect(within(screen.getByRole('list', { name: 'People' })).getByText('Kai Blas')).toBeInTheDocument()
    expect(within(screen.getByRole('list', { name: 'People' })).getByText(/66\.5h this period/)).toBeInTheDocument()
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
    expect(summary).toHaveTextContent('Overtime waiting—')

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
    await waitFor(() => expect(apiMock.getTimeEntries).toHaveBeenCalledWith(expect.objectContaining({ user_id: 7, start_date: '2026-10-15', end_date: '2026-10-31' })))
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
    // Focus moves in an effect after the form mounts; a slow runner can see the form first.
    await waitFor(() => expect(within(fix).getByLabelText(/Clocked out/)).toHaveFocus())
    expect(screen.getByRole('heading', { level: 2, name: 'Caleb Perez' })).toBeInTheDocument()
    // The linked-entry read canonicalizes the URL independently of form focus.
    await waitFor(() => expect(search().get('period')).toBe('2026-11-01'))
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

  it("names the current period's lock from the next lock when the headline lock is an older period", async () => {
    apiMock.getPayrollCutoff.mockResolvedValue({ data: {
      cutoff: { period: { id: 0, start_date: '2026-10-16', end_date: '2026-10-31' }, cutoff_at: '2026-11-07T17:00:00+10:00', stage: 'passed' },
      next_lock: { period: { id: 1, start_date: '2026-11-01', end_date: '2026-11-15' }, cutoff_at: '2026-11-18T17:00:00+10:00' },
    } })
    openAt('/admin/timecards')
    expect(await screen.findByText('Nov 1–15 · locks Wed, Nov 18')).toBeInTheDocument()
  })

  it('blocks Fix clock-out and Log missed time while work categories are missing, until a retry loads them', async () => {
    apiMock.getTimeCategories.mockResolvedValueOnce({ error: 'Server returned an invalid response (502)', status: 502 })
    openAt('/admin/timecards?user_id=7&period=2026-11-01')
    const alert = await screen.findByText("Couldn't load work categories.")
    const reason = "Work categories didn't load. Try again at the top of the page."
    expect(await screen.findByRole('button', { name: 'Fix clock-out' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Fix clock-out' })).toHaveAttribute('title', reason)
    expect(screen.getByRole('button', { name: 'Log missed time for Caleb' })).toBeDisabled()
    fireEvent.click(within(alert.closest('[role=alert]') as HTMLElement).getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(screen.queryByText("Couldn't load work categories.")).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Fix clock-out' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Log missed time for Caleb' })).toBeEnabled()
    expect(apiMock.getTimeCategories).toHaveBeenCalledTimes(2)
  })

  it('shows the linked shift’s fix blocked too when categories fail, rather than a form that can’t save', async () => {
    apiMock.getTimeCategories.mockResolvedValueOnce({ error: 'Server returned an invalid response (502)', status: 502 })
    openAt('/admin/timecards?entry_id=55&date=2026-11-10&view=day&user_id=7')
    const fix = await screen.findByRole('form', { name: /Fix clock-out/ })
    expect(within(fix).getByRole('alert')).toHaveTextContent("Work categories didn't load.")
    expect(within(fix).getByRole('button', { name: 'Save clock-out' })).toBeDisabled()
  })

  it('never says nobody needs a look when the hours report failed, and recovers on retry', async () => {
    apiMock.getHoursReport.mockResolvedValueOnce({ error: 'Something went wrong', status: 500 })
    openAt('/admin/timecards')
    expect(await screen.findByText("Couldn't load who needs a look.")).toBeInTheDocument()
    expect(screen.queryByText('Nobody needs a look.')).not.toBeInTheDocument()
    expect(screen.queryByText(/nothing waiting/i)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /People to check/ })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: /People to check/ })).not.toHaveTextContent(/\d/)
    fireEvent.click(within(screen.getByText("Couldn't load who needs a look.").closest('[role=alert]') as HTMLElement).getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(screen.queryByText("Couldn't load who needs a look.")).not.toBeInTheDocument())
    expect(await screen.findByText('Still clocked in')).toBeInTheDocument()
  })

  it('shows the error, not an empty "needs a look", when that chip is on and the report failed', async () => {
    apiMock.getHoursReport.mockResolvedValueOnce({ error: 'Something went wrong', status: 500 })
    openAt('/admin/timecards?filter=needs')
    expect(await screen.findByText("Couldn't load who needs a look.")).toBeInTheDocument()
    expect(screen.queryByText('Nobody needs a look.')).not.toBeInTheDocument()
  })

  it('refreshes the people and the open timecard when the tab comes back', async () => {
    openAt('/admin/timecards?user_id=7&period=2026-11-01')
    expect(await screen.findByRole('list', { name: 'Days in Nov 1–15' })).toBeInTheDocument()
    const reports = apiMock.getHoursReport.mock.calls.length
    const entries = apiMock.getTimeEntries.mock.calls.length
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
    await waitFor(() => expect(apiMock.getTimeEntries.mock.calls.length).toBeGreaterThan(entries))
    expect(apiMock.getHoursReport.mock.calls.length).toBeGreaterThan(reports)
  })

  it('doesn’t refresh the timecard under an open Fix clock-out, and keeps what was typed', async () => {
    openAt('/admin/timecards?user_id=7&period=2026-11-01')
    fireEvent.click(await screen.findByRole('button', { name: 'Fix clock-out' }))
    fireEvent.change(screen.getByLabelText(/Why the change/), { target: { value: 'Forgot' } })
    const entries = apiMock.getTimeEntries.mock.calls.filter(([params]) => params.user_id === 7).length
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
    expect(apiMock.getTimeEntries.mock.calls.filter(([params]) => params.user_id === 7)).toHaveLength(entries)
    expect(screen.getByLabelText(/Why the change/)).toHaveValue('Forgot')
  })

  it('doesn’t refresh under an open Log missed time sheet', async () => {
    openAt('/admin/timecards?user_id=7&period=2026-11-01')
    fireEvent.click(await screen.findByRole('button', { name: 'Log missed time for Caleb' }))
    const reports = apiMock.getHoursReport.mock.calls.length
    const entries = apiMock.getTimeEntries.mock.calls.length
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
    expect(apiMock.getHoursReport.mock.calls.length).toBe(reports)
    expect(apiMock.getTimeEntries.mock.calls.length).toBe(entries)
  })

  it('reloads the person’s time when a missed-time save can’t be confirmed', async () => {
    apiMock.createTimeEntry.mockResolvedValue({ error: 'Failed to fetch', errors: [] })
    openAt('/admin/timecards?user_id=7&period=2026-11-01')
    fireEvent.click(await screen.findByRole('button', { name: 'Log missed time for Caleb' }))
    fireEvent.change(within(screen.getByRole('dialog', { name: 'Log missed time' })).getByLabelText(/^Day/), { target: { value: '2026-11-11' } })
    const entries = apiMock.getTimeEntries.mock.calls.length
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Add 8.0h for Caleb' })) })
    expect(screen.getByText("We couldn't confirm this was saved. Check the timecard before adding it again.")).toBeInTheDocument()
    await waitFor(() => expect(apiMock.getTimeEntries.mock.calls.length).toBeGreaterThan(entries))
    expect(screen.getByRole('dialog', { name: 'Log missed time' })).toBeInTheDocument()
  })

  it('waits for a scheduled shift before Log missed time can open, then opens it filled in', async () => {
    let resolveSchedule: (value: unknown) => void = () => undefined
    apiMock.getSchedule.mockReturnValue(new Promise((resolve) => { resolveSchedule = resolve }))
    openAt('/admin/timecards?prefill=true&schedule_id=4&user_id=7')
    const log = await screen.findByRole('button', { name: 'Log missed time for Caleb' })
    expect(log).toBeDisabled()
    expect(log).toHaveAttribute('title', 'Loading the scheduled shift…')
    await act(async () => {
      resolveSchedule({ data: { schedule: { id: 4, user_id: 7, work_date: '2026-11-11', start_time: '06:00', end_time: '14:00', formatted_time_range: '6:00 AM – 2:00 PM', notes: null } } })
    })
    const sheet = await screen.findByRole('dialog', { name: 'Log missed time' })
    expect(within(sheet).getByLabelText(/^Day/)).toHaveValue('2026-11-11')
    expect(within(sheet).getByLabelText(/^Start/)).toHaveValue('06:00')
  })

  it('shows Approved as approved for pay, with overtime still waiting on its own, as the person page does', async () => {
    const days = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-06', '2026-11-09']
    apiMock.getTimeEntries.mockImplementation(async (params: { user_id?: number }) => ({
      data: { time_entries: params.user_id === 9 ? [
        ...days.map((date, index) => entry({ id: 80 + index, work_date: date, hours: 11.5, overtime_status: date === '2026-11-06' ? 'pending' : 'none', user: { ...OPEN.user, id: 9 } })),
        entry({ id: 90, work_date: '2026-11-11', hours: 11.5, approval_status: 'pending', user: { ...OPEN.user, id: 9 } }),
      ] : [], pagination: { total_pages: 1 } },
    }))
    apiMock.getHoursReport.mockImplementation(async () => ({ data: { employees: [{
      ...summaryRow(9, 0), total_hours: 57.5, overtime_hours: 6,
      days: days.map((date, index) => ({ work_date: date, entries: [reportShift(80 + index, 11.5, { work_date: date, ...(date === '2026-11-06' ? { overtime_hours: 6, overtime_status: 'pending' } : {}) })] })),
      excluded_entries: [reportShift(90, 11.5, { work_date: '2026-11-11', approval_status: 'pending' })],
    }] } }))
    openAt('/admin/timecards?user_id=9&period=2026-11-01')
    const summary = (await screen.findByText('Approved', { selector: 'dt' })).closest('dl')!
    await waitFor(() => expect(summary).toHaveTextContent('Approved51.5h'))
    expect(summary).toHaveTextContent('Waiting11.5h')
    expect(summary).toHaveTextContent('Overtime waiting6.0h')
  })

  it('shows an overnight shift from Oct 31 on Nov 1 with only November’s hours, matching the summary', async () => {
    const overnight = entry({
      id: 70, work_date: '2026-10-31', start_time: '22:30', end_time: '06:30', formatted_start_time: '10:30 PM', formatted_end_time: '6:30 AM',
      hours: 8, clock_in_at: '2026-10-31T22:30:00+10:00', clock_out_at: '2026-11-01T06:30:00+10:00',
      user: { ...OPEN.user, id: 9, full_name: 'Ethan Cruz', display_name: 'Ethan Cruz' },
    })
    apiMock.getTimeEntries.mockImplementation(async (params: { user_id?: number; start_date?: string }) => ({
      data: { time_entries: params.user_id === 9 && params.start_date === '2026-10-31' ? [overnight] : [], pagination: { total_pages: 1 } },
    }))
    apiMock.getHoursReport.mockImplementation(async () => ({ data: { summary_only: true, employees: [{ ...summaryRow(9, 6.5), entries_count: 1 }] } }))
    openAt('/admin/timecards?user_id=9&period=2026-11-01')
    const days = await screen.findByRole('list', { name: 'Days in Nov 1–15' })
    const nov1 = within(days).getByRole('article', { name: 'Sunday, November 1' })
    expect(nov1).toHaveTextContent('10:30p–6:30a')
    expect(nov1).toHaveTextContent('Continues from Sat, Oct 31 · 6.5h in this period')
    expect(within(nov1).getByRole('button', { name: /Edit shift/ })).toHaveAttribute('id', 'timecard-entry-70-continued')
    expect(screen.getByText('Approved', { selector: 'dt' }).closest('dl')).toHaveTextContent('Approved6.5h')
  })

  it('scrolls a link to a shift shown only as its continuation to that row', async () => {
    const overnight = entry({
      id: 71, work_date: '2026-10-31', start_time: '22:30', end_time: '06:30', formatted_start_time: '10:30 PM', formatted_end_time: '6:30 AM',
      hours: 8, clock_in_at: '2026-10-31T22:30:00+10:00', clock_out_at: '2026-11-01T06:30:00+10:00',
      user: { ...OPEN.user, id: 9, full_name: 'Ethan Cruz', display_name: 'Ethan Cruz' },
    })
    apiMock.getTimeEntries.mockImplementation(async (params: { user_id?: number; start_date?: string }) => ({
      data: { time_entries: params.user_id === 9 && params.start_date === '2026-10-31' ? [overnight] : [], pagination: { total_pages: 1 } },
    }))
    apiMock.getHoursReport.mockImplementation(async () => ({ data: { summary_only: true, employees: [{ ...summaryRow(9, 6.5), entries_count: 1 }] } }))
    apiMock.getTimeEntry.mockResolvedValue({ data: { time_entry: overnight } })
    const scrolled: string[] = []
    const scrollIntoView = vi.fn(function (this: HTMLElement) { scrolled.push(this.id) })
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scrollIntoView })
    try {
      openAt('/admin/timecards?user_id=9&period=2026-11-01&entry_id=71')
      await screen.findByRole('list', { name: 'Days in Nov 1–15' })
      await waitFor(() => expect(scrolled).toEqual(['timecard-entry-71-continued']))
    } finally {
      delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView
    }
  })

  it('shows a loading state for a linked person while people load', async () => {
    let resolveUsers: (value: unknown) => void = () => undefined
    apiMock.getUsers.mockReturnValue(new Promise((resolve) => { resolveUsers = resolve }))
    openAt('/admin/timecards?user_id=7&period=2026-11-01')
    expect(await screen.findByLabelText('Loading the timecard')).toBeInTheDocument()
    await act(async () => { resolveUsers({ data: { users: USERS } }) })
    expect(await screen.findByRole('heading', { level: 2, name: 'Caleb Perez' })).toBeInTheDocument()
  })


  it('after a conflict, reloads the shift and saves with its current version', async () => {
    apiMock.updateTimeEntry
      .mockResolvedValueOnce({ error: 'This entry changed. Reload it before submitting the correction', status: 409, code: 'stale_entry' })
      .mockResolvedValueOnce({ data: { time_entry: OPEN } })
    openAt('/admin/timecards?user_id=7&period=2026-11-01')
    const fill = async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'Fix clock-out' }))
      fireEvent.change(screen.getByLabelText(/Clocked out/), { target: { value: '15:30' } })
      fireEvent.change(screen.getByLabelText(/Why the change/), { target: { value: 'Forgot' } })
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save clock-out' })) })
    }
    await fill()
    expect(apiMock.updateTimeEntry).toHaveBeenLastCalledWith(55, expect.objectContaining({ expected_version: 4 }), 'Corrected clock-out: Forgot')

    // Someone else changed it meanwhile; the reload brings version 5.
    apiMock.getTimeEntries.mockImplementation(async (params: { user_id?: number; start_date?: string; end_date?: string }) => ({
      data: { time_entries: params.user_id === 7 ? [CALEB_ENTRIES[0], CALEB_ENTRIES[1], { ...OPEN, version: 5 }] : [], pagination: { total_pages: 1 } },
    }))
    fireEvent.click(screen.getByRole('button', { name: 'Reload this shift' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Reload this shift' })).not.toBeInTheDocument())
    await fill()
    expect(apiMock.updateTimeEntry).toHaveBeenLastCalledWith(55, expect.objectContaining({ expected_version: 5 }), 'Corrected clock-out: Forgot')
  })

  it('keeps Fix clock-out and shift edits disabled until the reload after a conflict arrives', async () => {
    apiMock.updateTimeEntry.mockResolvedValueOnce({ error: 'This entry changed. Reload it before submitting the correction', status: 409, code: 'stale_entry' })
    openAt('/admin/timecards?user_id=7&period=2026-11-01')
    fireEvent.click(await screen.findByRole('button', { name: 'Fix clock-out' }))
    fireEvent.change(screen.getByLabelText(/Clocked out/), { target: { value: '15:30' } })
    fireEvent.change(screen.getByLabelText(/Why the change/), { target: { value: 'Forgot' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save clock-out' })) })

    // Hold the reload: the old entries stay on screen, but nothing can act on them.
    let resolveReload: (value: unknown) => void = () => undefined
    apiMock.getTimeEntries.mockImplementation((params: { user_id?: number }) => params.user_id === 7
      ? new Promise((resolve) => { resolveReload = resolve })
      : Promise.resolve({ data: { time_entries: [], pagination: { total_pages: 1 } } }))
    fireEvent.click(screen.getByRole('button', { name: 'Reload this shift' }))
    const loadingReason = 'Loading the latest copy of these shifts…'
    const fix = await screen.findByRole('button', { name: 'Fix clock-out' })
    expect(fix).toBeDisabled()
    expect(fix).toHaveAttribute('title', loadingReason)
    const edits = screen.getAllByRole('button', { name: /Edit shift$/ })
    expect(edits.length).toBeGreaterThan(0)
    edits.forEach(edit => expect(edit).toBeDisabled())
    fireEvent.click(edits[0])
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    await act(async () => {
      resolveReload({ data: { time_entries: [CALEB_ENTRIES[0], CALEB_ENTRIES[1], { ...OPEN, version: 5 }], pagination: { total_pages: 1 } } })
    })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Fix clock-out' })).toBeEnabled())
    screen.getAllByRole('button', { name: /Edit shift$/ }).forEach(edit => expect(edit).toBeEnabled())
  })

  it('keeps the person for Log missed time when a desktop Everyone link opens on a phone', async () => {
    openAt('/admin/timecards?user_id=7&period=2026-11-01&view=everyone')
    fireEvent.click(await screen.findByRole('button', { name: 'Log missed time for Caleb' }))
    expect(within(screen.getByRole('dialog', { name: 'Log missed time' })).getByRole('button', { name: /Who worked/ })).toHaveTextContent('Caleb Perez')
  })

  it('keeps the way back to the list when the person can’t be found', async () => {
    openAt('/admin/timecards?user_id=999&period=2026-11-01')
    expect(await screen.findByText("We couldn't find that person.")).toBeInTheDocument()
    fireEvent.click(screen.getByRole('link', { name: 'Timecards' }))
    expect(search().get('user_id')).toBeNull()
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

  it("shows each person's hours worked on the list, equal to their timecard's Approved + Waiting + Overtime waiting", async () => {
    // Ethan, Nov 1–15: five approved 11.5h shifts, 6.0h of one's overtime still
    // waiting, and one 11.5h shift waiting. The summary row counts 57.5h and 11.5h waiting.
    const days = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-06', '2026-11-09']
    apiMock.getTimeEntries.mockImplementation(async (params: { user_id?: number }) => ({
      data: { time_entries: params.user_id === 9 ? [
        ...days.map((date, index) => entry({ id: 80 + index, work_date: date, hours: 11.5, overtime_status: date === '2026-11-06' ? 'pending' : 'none', user: { ...OPEN.user, id: 9 } })),
        entry({ id: 90, work_date: '2026-11-11', hours: 11.5, approval_status: 'pending', user: { ...OPEN.user, id: 9 } }),
      ] : [], pagination: { total_pages: 1 } },
    }))
    apiMock.getHoursReport.mockImplementation(async (params: { user_id?: number; summary_only?: number }) => {
      if (params.summary_only) {
        return { data: { summary_only: true, employees: [{ ...summaryRow(9, 0, { pending_count: 1, pending_overtime_count: 1 }), total_hours: 57.5, overtime_hours: 6, waiting_hours: 11.5, entries_count: 6 }] } }
      }
      return { data: { employees: [{
        ...summaryRow(9, 0), total_hours: 57.5, overtime_hours: 6,
        days: days.map((date, index) => ({ work_date: date, entries: [reportShift(80 + index, 11.5, { work_date: date, ...(date === '2026-11-06' ? { overtime_hours: 6, overtime_status: 'pending' } : {}) })] })),
        excluded_entries: [reportShift(90, 11.5, { work_date: '2026-11-11', approval_status: 'pending' })],
      }] } }
    })
    openAt('/admin/timecards?user_id=9&period=2026-11-01')
    const summary = (await screen.findByText('Approved', { selector: 'dt' })).closest('dl')!
    await waitFor(() => expect(summary).toHaveTextContent('Approved51.5h'))
    expect(summary).toHaveTextContent('Waiting11.5h')
    expect(summary).toHaveTextContent('Overtime waiting6.0h')

    const row = within(screen.getByRole('list', { name: 'People' })).getByText('Ethan Cruz').closest('[role="listitem"]') as HTMLElement
    // 51.5 + 11.5 + 6.0 = 69.0, with no "approved" figure to disagree with the timecard.
    expect(row).toHaveTextContent('69.0h this period')
    expect(row).not.toHaveTextContent(/approved/i)
  })

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

  it('won’t open a shift from Everyone while work categories failed, and opens it after Try again', async () => {
    apiMock.getTimeCategories.mockResolvedValueOnce({ error: 'Server returned an invalid response (502)', status: 502 })
    apiMock.getTimeEntries.mockImplementation(async (params: { week?: string }) => ({
      data: { time_entries: params.week ? [CALEB_ENTRIES[0]] : [], pagination: { total_pages: 1 } },
    }))
    openAt('/admin/timecards?view=everyone&date=2026-11-02')
    const alert = await screen.findByText("Couldn't load work categories.")
    const card = await screen.findByRole('button', { name: /8\.63h/ })
    fireEvent.click(card)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByText(/Shifts can't be opened right now\. Work categories didn't load\./)).toBeInTheDocument()

    fireEvent.click(within(alert.closest('[role=alert]') as HTMLElement).getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(screen.queryByText(/Shifts can't be opened right now/)).not.toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /8\.63h/ }))
    const editor = await screen.findByRole('dialog')
    expect(within(editor).queryByText(/Assign an active work category/)).not.toBeInTheDocument()
    expect(within(editor).getByRole('option', { name: 'Ground Operations' })).toBeInTheDocument()
  })

  it('opens Log missed time from the header with nobody chosen in Everyone', async () => {
    openAt('/admin/timecards?view=everyone')
    fireEvent.click(await screen.findByRole('button', { name: 'Log missed time' }))
    expect(within(screen.getByRole('dialog', { name: 'Log missed time' })).getByRole('combobox', { name: 'Who worked' })).toHaveValue('')
    expect(screen.getByRole('button', { name: 'Add shift' })).toBeDisabled()
  })
})
