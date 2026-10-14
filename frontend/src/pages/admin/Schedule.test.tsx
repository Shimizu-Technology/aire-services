import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Schedule from './Schedule'
import { formatDateInTimeZoneISO } from '../../lib/dateUtils'

const mocks = vi.hoisted(() => ({
  getSchedules: vi.fn(), getScheduleTimePresets: vi.fn(), deleteSchedule: vi.fn(), createSchedule: vi.fn(), updateSchedule: vi.fn(),
  auth: { isClerkEnabled: true, userRole: 'admin', currentUser: { id: 1 } },
}))
vi.mock('../../lib/api', () => ({ api: mocks }))
vi.mock('../../contexts/AuthContext', () => ({ useAuthContext: () => mocks.auth }))
vi.mock('../../components/ui/MotionComponents', () => ({ FadeUp: ({ children }: { children: React.ReactNode }) => children }))
function Harness() {
  const location = useLocation()
  return <><output data-testid="route">{location.pathname}{location.search}</output><Schedule /></>
}
function open() { render(<MemoryRouter><Harness /></MemoryRouter>) }

describe('Schedule handoff and failures', () => {
  afterEach(() => vi.unstubAllGlobals())
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.auth.userRole = 'admin'
    mocks.getScheduleTimePresets.mockResolvedValue({ data: { presets: [] } })
    mocks.getSchedules.mockResolvedValue({ data: {
      users: [{ id: 7, display_name: 'Casey', email: 'casey@example.test' }],
      schedules: [{ id: 9, user_id: 7, work_date: formatDateInTimeZoneISO(new Date(), 'Pacific/Guam'), start_time: '09:00', end_time: '17:00', formatted_time_range: '9 AM - 5 PM', hours: 8 }],
    } })
  })

  it('retains the selected employee and original week when opening their workspace', async () => {
    mocks.getSchedules.mockResolvedValue({ data: { users: [{ id: 7, display_name: 'Casey', email: 'casey@example.test' }], schedules: [{ id: 9, user_id: 7, work_date: '2026-08-20', start_time: '09:00', end_time: '17:00', formatted_time_range: '9 AM - 5 PM', hours: 8 }] } })
    render(<MemoryRouter initialEntries={['/admin/schedule?user_id=7&week_start=2026-08-16&team=Casey&return_to=%2Fadmin%2Fusers%2F7%3Ftab%3Dschedule']}><Harness /></MemoryRouter>)
    const employeeLink = await screen.findByRole('link', { name: 'Casey' })
    const target = new URL(employeeLink.getAttribute('href')!, 'https://local.invalid')
    expect(target.pathname).toBe('/admin/users/7')
    expect(target.searchParams.get('return_to')).toBe('/admin/schedule?user_id=7&week_start=2026-08-16&team=Casey&return_to=%2Fadmin%2Fusers%2F7%3Ftab%3Dschedule')
    expect(target.searchParams.get('start_date')).toBe('2026-08-16')
    expect(screen.getByRole('link', { name: 'Back to employee review' })).toHaveAttribute('href', '/admin/users/7?tab=schedule')
    fireEvent.click(screen.getByRole('button', { name: 'Next week' }))
    expect(screen.getByTestId('route')).toHaveTextContent('week_start=2026-08-23')
    expect(screen.getByTestId('route')).toHaveTextContent('user_id=7')
  })

  it('links Log Time to the exact saved shift and employee', async () => {
    open()
    fireEvent.click(await screen.findByRole('button', { name: 'Log Time' }))
    expect(screen.getByTestId('route')).toHaveTextContent('/admin/time?prefill=true&schedule_id=9&user_id=7')
  })

  it('shows returned API failures with a retry instead of an empty schedule', async () => {
    mocks.getSchedules.mockResolvedValueOnce({ error: 'Schedule unavailable' })
    open()
    await screen.findByText('Schedule unavailable')
    expect(screen.queryByText('No shifts scheduled this week')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry loading schedules' }))
    await screen.findByRole('button', { name: 'Log Time' })
  })

  it('keeps the edit dialog open when a deletion is rejected', async () => {
    vi.stubGlobal('confirm', vi.fn(() => true))
    mocks.deleteSchedule.mockResolvedValue({ error: 'Cannot delete this shift' })
    open()
    fireEvent.click(await screen.findByRole('button', { name: 'Edit shift' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await screen.findByText('Cannot delete this shift')
    expect(screen.getByRole('heading', { name: 'Edit Shift' })).toBeInTheDocument()
    expect(mocks.getSchedules).toHaveBeenCalledTimes(2)
  })

  it('does not offer administrative commands or another employee’s Log Time to staff', async () => {
    mocks.auth.userRole = 'employee'
    open()
    await waitFor(() => expect(mocks.getSchedules).toHaveBeenCalled())
    await screen.findByText('Casey')
    expect(screen.queryByRole('button', { name: 'Edit shift' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Log Time' })).not.toBeInTheDocument()
  })
  it('shows leave without a shift and permits saving after the warning on the chosen date', async () => {
    const leave = { id: 3, user_id: 7, start_date: '2026-11-08', end_date: '2026-11-09' }
    mocks.getSchedules.mockResolvedValue({ data: { users: [{ id: 7, display_name: 'Casey', email: 'casey@example.test' }], schedules: [], approved_leave: [leave] } })
    mocks.createSchedule.mockResolvedValue({ data: { schedule: { id: 10 } } })
    render(<MemoryRouter initialEntries={['/admin/schedule?week_start=2026-11-08']}><Harness /></MemoryRouter>)
    await screen.findByRole('region', { name: 'Approved leave this week' })
    fireEvent.click(screen.getByRole('button', { name: 'Add shift' }))
    const dialog = screen.getByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Employee'), { target: { value: '7' } })
    await within(dialog).findByText('Approved leave overlaps this shift')
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeDisabled()
    fireEvent.change(within(dialog).getByLabelText('Date'), { target: { value: '2026-11-09' } })
    await waitFor(() => expect(mocks.getSchedules).toHaveBeenLastCalledWith({ user_id: 7, start_date: '2026-11-09', end_date: '2026-11-09' }))
    fireEvent.click(within(dialog).getByLabelText('I have checked this conflict and want to save this shift.'))
    fireEvent.change(within(dialog).getByLabelText('Scheduling reason'), { target: { value: 'Confirmed revised shift with scheduler' } })
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Save' })).toBeEnabled())
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(mocks.createSchedule).toHaveBeenCalledWith(expect.objectContaining({ user_id: 7, work_date: '2026-11-09' })))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('retains all shift fields when approved leave is first detected at save time', async () => {
    mocks.createSchedule.mockResolvedValueOnce({ error: 'Approved leave overlaps this shift', code: 'leave_conflict_acknowledgement_required', approved_leave: [{ id: 3, user_id: 7, start_date: '2026-11-08', end_date: '2026-11-08' }] })
    render(<MemoryRouter initialEntries={['/admin/schedule?week_start=2026-11-08']}><Harness /></MemoryRouter>)
    fireEvent.click(await screen.findByRole('button', { name: 'Add shift' }))
    const dialog = screen.getByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Employee'), { target: { value: '7' } })
    fireEvent.change(within(dialog).getByLabelText('Notes (optional)'), { target: { value: 'Retain this shift draft' } })
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Save' })).toBeEnabled())
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await within(dialog).findByRole('status')
    expect(within(dialog).getByLabelText('Notes (optional)')).toHaveValue('Retain this shift draft')
    expect(within(dialog).getByLabelText('Employee')).toHaveValue('7')
    expect(within(dialog).getByLabelText('Date')).toHaveValue('2026-11-08')
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeDisabled()
    fireEvent.click(within(dialog).getByLabelText('I have checked this conflict and want to save this shift.'))
    fireEvent.change(within(dialog).getByLabelText('Scheduling reason'), { target: { value: 'Confirmed shift' } })
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeEnabled()
    fireEvent.change(within(dialog).getByLabelText('Start Time'), { target: { value: '09:00' } })
    expect(within(dialog).getByLabelText('I have checked this conflict and want to save this shift.')).not.toBeChecked()
    expect(within(dialog).getByLabelText('Scheduling reason')).toHaveValue('Confirmed shift')
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(mocks.createSchedule).toHaveBeenCalledTimes(1)
  })

  it('preserves the shift draft when availability fails, supports retry and keeps Cancel reachable', async () => {
    open()
    fireEvent.click(await screen.findByRole('button', { name: 'Add shift' }))
    mocks.getSchedules.mockResolvedValueOnce({ error: 'Unavailable' })
    const dialog = screen.getByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Employee'), { target: { value: '7' } })
    await within(dialog).findByRole('alert')
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeEnabled()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Retry leave check' }))
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Save' })).toBeEnabled())
    expect(within(dialog).getByLabelText('Employee')).toHaveValue('7')
    expect(mocks.createSchedule).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('can add a shift on a phone without entering the desktop grid, and Escape returns focus', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 })
    mocks.getSchedules.mockResolvedValue({ data: { users: [{ id: 7, display_name: 'Casey', email: 'casey@example.test' }], schedules: [] } })
    open()
    await screen.findByText('No shifts scheduled this week')
    const trigger = screen.getByRole('button', { name: 'Add shift' })
    trigger.focus()
    fireEvent.click(trigger)
    await screen.findByRole('dialog', { name: 'Add Shift' })
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(trigger).toHaveFocus()
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 })
  })

})
