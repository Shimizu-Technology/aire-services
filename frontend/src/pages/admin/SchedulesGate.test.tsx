import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { UserRole } from '../../lib/roles'
import SchedulesGate from './SchedulesGate'
import ScheduleSettings from '../../components/time-tracking/ScheduleSettings'
import { WebsiteHome } from './Website'

const auth = vi.hoisted(() => ({ role: 'employee' as UserRole, schedulesEnabled: false, refreshCurrentUser: vi.fn() }))
vi.mock('../../contexts/AuthContext', () => ({
  useAuthContext: () => ({ isClerkEnabled: true, userRole: auth.role, currentUser: { schedules_enabled: auth.schedulesEnabled }, refreshCurrentUser: auth.refreshCurrentUser }),
}))
const apiMock = vi.hoisted(() => ({ updateAdminAppSettings: vi.fn() }))
vi.mock('../../lib/api', () => ({ api: apiMock }))

const settings = (overrides: Record<string, string> = {}) => ({
  overtime_daily_threshold_hours: '8', overtime_weekly_threshold_hours: '40', early_clock_in_buffer_minutes: '5',
  clock_in_location_enforced: 'false', clock_in_location_name: 'AIRE', clock_in_location_latitude: '13.4', clock_in_location_longitude: '144.7',
  clock_in_location_radius_meters: '1000', schedules_enabled: 'false', schedule_required_for_clock_in: 'false', ...overrides,
})

beforeEach(() => {
  auth.role = 'employee'
  auth.schedulesEnabled = false
  auth.refreshCurrentUser.mockReset().mockResolvedValue(undefined)
  apiMock.updateAdminAppSettings.mockReset()
})

describe('Schedule page gate', () => {
  it('tells staff schedules are off instead of showing an empty calendar', () => {
    render(<MemoryRouter><SchedulesGate><p>Calendar</p></SchedulesGate></MemoryRouter>)
    expect(screen.getByRole('heading', { name: 'Schedules are turned off' })).toBeInTheDocument()
    expect(screen.queryByText('Calendar')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Settings/ })).not.toBeInTheDocument()
    expect(screen.getByText(/An owner or admin can turn schedules on/)).toBeInTheDocument()
  })

  it('links owners and admins to the switch in Settings', () => {
    auth.role = 'admin'
    render(<MemoryRouter><SchedulesGate><p>Calendar</p></SchedulesGate></MemoryRouter>)
    expect(screen.getByRole('link', { name: 'Turn on schedules in Settings' })).toHaveAttribute('href', '/admin/settings#use-schedules')
  })

  it('shows the Schedule page as before when schedules are on', () => {
    auth.schedulesEnabled = true
    render(<MemoryRouter><SchedulesGate><p>Calendar</p></SchedulesGate></MemoryRouter>)
    expect(screen.getByText('Calendar')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Schedules are turned off' })).not.toBeInTheDocument()
  })
})

describe('"Use schedules" switch', () => {
  it('starts off, explains itself, and turns on with one saved setting', async () => {
    const onSaved = vi.fn()
    apiMock.updateAdminAppSettings.mockResolvedValue({ data: { settings: settings({ schedules_enabled: 'true' }) } })
    render(<ScheduleSettings settings={settings()} onSaved={onSaved} />)

    const toggle = screen.getByRole('checkbox', { name: 'Use schedules' })
    expect(toggle).not.toBeChecked()
    expect(toggle).toHaveAccessibleDescription(/Shows Schedule in everyone’s menu/)
    fireEvent.click(screen.getByRole('button', { name: 'About Use schedules' }))
    expect(screen.getAllByText('Owners and admins').length).toBeGreaterThan(0)

    fireEvent.click(toggle)
    await waitFor(() => expect(apiMock.updateAdminAppSettings).toHaveBeenCalledWith({ settings: { schedules_enabled: 'true' } }))
    expect(await screen.findByText('Schedule is now in everyone’s menu.')).toHaveAttribute('role', 'status')
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ schedules_enabled: 'true' }))
    // The menu reads the switch from the signed-in profile.
    expect(auth.refreshCurrentUser).toHaveBeenCalledOnce()
  })

  it('keeps the switch and the menu unchanged when saving fails', async () => {
    const onSaved = vi.fn()
    apiMock.updateAdminAppSettings.mockResolvedValue({ error: 'Not allowed' })
    render(<ScheduleSettings settings={settings()} onSaved={onSaved} />)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Use schedules' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Not allowed')
    expect(onSaved).not.toHaveBeenCalled()
    expect(auth.refreshCurrentUser).not.toHaveBeenCalled()
  })

  it('warns when clock-in requires a schedule but schedules are off', () => {
    render(<ScheduleSettings settings={settings({ schedule_required_for_clock_in: 'true' })} onSaved={vi.fn()} />)
    expect(screen.getByRole('note')).toHaveTextContent('anyone without one can’t clock in')
  })
})

describe('Website overview', () => {
  it('groups the public-site pages', () => {
    render(<MemoryRouter><WebsiteHome /></MemoryRouter>)
    expect(screen.getByRole('heading', { level: 1, name: 'Website' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Photos & videos/ })).toHaveAttribute('href', '/admin/website/media')
    expect(screen.getByRole('link', { name: /Contact & links/ })).toHaveAttribute('href', '/admin/website/contact')
    expect(screen.getByRole('link', { name: /Public team profiles/ })).toHaveAttribute('href', '/admin/users?public=visible')
  })
})
