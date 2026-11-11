import '@testing-library/jest-dom'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import AdminLayout from './AdminLayout'

type Role = 'owner' | 'admin' | 'manager' | 'employee'
interface TestUser {
  id?: number
  full_name: string
  needs_kiosk_pin_setup: boolean
  my_pay_enabled?: boolean
  schedules_enabled?: boolean
  time_tracking_enabled?: boolean
}

const authMock = vi.hoisted(() => ({
  value: {
    isClerkEnabled: true,
    userRole: 'employee' as Role,
    currentUser: { full_name: 'Hourly Pilot', needs_kiosk_pin_setup: true } as TestUser,
    refreshCurrentUser: vi.fn(),
  },
}))

const apiMock = vi.hoisted(() => ({
  setMyKioskPin: vi.fn(),
  getPendingApprovals: vi.fn(),
}))

vi.mock('../../contexts/AuthContext', () => ({
  useAuthContext: () => authMock.value,
}))

vi.mock('../../lib/api', () => ({
  api: apiMock,
}))

vi.mock('@clerk/clerk-react', () => ({
  SignedIn: ({ children }: { children: ReactNode }) => {
    if (!authMock.value.isClerkEnabled) throw new Error('SignedIn rendered without ClerkProvider')
    return <>{children}</>
  },
  UserButton: () => <div>User menu</div>,
}))

const PAGES = ['/admin', '/admin/approvals', '/admin/leave', '/admin/timecards', '/admin/reports', '/admin/payroll', '/admin/pay', '/admin/pay/:id', '/admin/pay-stubs', '/admin/users', '/admin/settings', '/admin/website/media', '/admin/my-time', '/admin/my-hours', '/admin/schedule', '/admin/activity']

function renderLayout(initialEntry = '/admin') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route element={<AdminLayout />}>
          {PAGES.map((path) => <Route key={path} path={path} element={<div>{`Page ${path}`}</div>} />)}
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

function signIn(role: Role, user: Partial<TestUser> = {}) {
  authMock.value.userRole = role
  authMock.value.currentUser = { id: 9, full_name: 'Team Member', needs_kiosk_pin_setup: false, my_pay_enabled: true, time_tracking_enabled: true, ...user }
}

const sidebar = () => screen.getByRole('navigation', { name: 'Main' })
const tabBar = () => screen.getByRole('navigation', { name: 'Main tabs' })
// The visible label of each link, without its badge.
const names = (container: HTMLElement) => within(container).queryAllByRole('link').map((link) => link.querySelector('.truncate')?.textContent?.trim())
const groupNames = (label: string) => names(within(sidebar()).getByRole('group', { name: label }))

beforeEach(() => {
  window.localStorage.clear()
  authMock.value.isClerkEnabled = true
  authMock.value.refreshCurrentUser.mockReset()
  apiMock.setMyKioskPin.mockReset().mockResolvedValue({ data: { user: {} } })
  apiMock.getPendingApprovals.mockReset().mockResolvedValue({ data: { summary: { entry_count: 0 } } })
  signIn('employee')
})

describe('AdminLayout sidebar by role', () => {
  it('gives owners and admins the week’s work, then admin pages, then their own time', () => {
    for (const role of ['owner', 'admin'] as const) {
      signIn(role)
      const view = renderLayout()
      expect(groupNames('Workspace')).toEqual(['Today', 'Approvals', 'Timecards', 'Payroll', 'Team', 'Reports', 'Pay stubs'])
      expect(groupNames('Admin')).toEqual(['Settings', 'Website', 'Activity'])
      expect(groupNames('Me')).toEqual(['My Time', 'My Pay', 'Unlock kiosk'])
      view.unmount()
    }
  })

  it('gives managers the team’s time, then theirs', () => {
    signIn('manager')
    renderLayout()
    expect(groupNames('Workspace')).toEqual(['Approvals', 'Timecards', 'Reports', 'Pay stubs'])
    expect(groupNames('Me')).toEqual(['My Time', 'My Pay', 'Unlock kiosk'])
    expect(within(sidebar()).queryByRole('group', { name: 'Admin' })).not.toBeInTheDocument()
    expect(screen.getByText('Manager workspace', { selector: 'div' })).toBeInTheDocument()
  })

  it('gives employees their own time only', () => {
    signIn('employee')
    renderLayout()
    expect(groupNames('Workspace')).toEqual(['Clock', 'My Hours', 'Leave', 'My Pay'])
    expect(within(sidebar()).queryByRole('group', { name: 'Me' })).not.toBeInTheDocument()
  })

  it('leaves out My Pay and My Time when they are off for the person', () => {
    signIn('admin', { my_pay_enabled: false, time_tracking_enabled: false })
    renderLayout()
    expect(groupNames('Me')).toEqual(['Unlock kiosk'])
  })

  it('points each item at its route and opens the kiosk in a new tab', () => {
    signIn('admin')
    renderLayout()
    const hrefs = Object.fromEntries(within(sidebar()).getAllByRole('link').map((link) => [link.getAttribute('aria-label'), link.getAttribute('href')]))
    expect(hrefs).toMatchObject({
      Today: '/admin', Approvals: '/admin/approvals', Timecards: '/admin/timecards', Payroll: '/admin/payroll', Team: '/admin/users',
      Reports: '/admin/reports', 'Pay stubs': '/admin/pay-stubs', Settings: '/admin/settings', Website: '/admin/website', Activity: '/admin/activity',
      'My Time': '/admin/my-time', 'My Pay': '/admin/pay', 'Unlock kiosk (opens in a new tab)': '/kiosk',
    })
    expect(within(sidebar()).getByRole('link', { name: /Unlock kiosk/ })).toHaveAttribute('target', '_blank')
  })

  it.each([
    ['/admin', 'Today'],
    ['/admin/approvals', 'Approvals'],
    ['/admin/leave', 'Approvals'],
    ['/admin/timecards', 'Timecards'],
    ['/admin/payroll', 'Payroll'],
    ['/admin/pay', 'My Pay'],
    ['/admin/pay/42', 'My Pay'],
    ['/admin/pay-stubs', 'Pay stubs'],
    ['/admin/website/media', 'Website'],
  ])('marks only the matching item current on %s', (path, active) => {
    signIn('admin')
    renderLayout(path)
    const current = within(sidebar()).getAllByRole('link').filter((link) => link.getAttribute('aria-current') === 'page')
    expect(current.map((link) => link.getAttribute('aria-label'))).toEqual([active])
  })

  it('keeps Leave as its own item for employees', () => {
    signIn('employee')
    renderLayout('/admin/leave')
    const current = within(sidebar()).getAllByRole('link').filter((link) => link.getAttribute('aria-current') === 'page')
    expect(current.map((link) => link.getAttribute('aria-label'))).toEqual(['Leave'])
  })
})

describe('"Use schedules"', () => {
  it.each(['owner', 'admin', 'manager', 'employee'] as const)('hides Schedule from a %s while it is off', (role) => {
    signIn(role, { schedules_enabled: false })
    renderLayout()
    expect(screen.queryByRole('link', { name: 'Schedule' })).not.toBeInTheDocument()
  })

  it.each([
    ['admin', 'Workspace', ['Today', 'Approvals', 'Timecards', 'Schedule', 'Payroll', 'Team', 'Reports', 'Pay stubs']],
    ['manager', 'Me', ['My Time', 'My Pay', 'Schedule', 'Unlock kiosk']],
    ['employee', 'Workspace', ['Clock', 'My Hours', 'Leave', 'My Pay', 'Schedule']],
  ] as const)('shows Schedule to a %s when it is on', (role, group, expected) => {
    signIn(role, { schedules_enabled: true })
    renderLayout()
    expect(groupNames(group)).toEqual(expected)
  })
})

describe('AdminLayout phone tab bar', () => {
  it('gives managers Approvals, Timecards, Reports and My Time, with the rest under More', async () => {
    signIn('manager')
    apiMock.getPendingApprovals.mockResolvedValue({ data: { summary: { entry_count: 12 } } })
    renderLayout('/admin/approvals')

    const approvals = await within(tabBar()).findByRole('link', { name: 'Approvals, 12 waiting' })
    expect(approvals).toHaveAttribute('aria-current', 'page')
    expect(approvals).toHaveTextContent('12')
    expect(names(tabBar())).toEqual(['Approvals', 'Timecards', 'Reports', 'My Time'])
    expect(apiMock.getPendingApprovals).toHaveBeenCalledWith({ page: 1, per_page: 1 })

    fireEvent.click(within(tabBar()).getByRole('button', { name: 'More' }))
    const sheet = screen.getByRole('dialog', { name: 'More' })
    expect(names(sheet)).toEqual(['Pay stubs', 'My Pay', 'Unlock kiosk'])
    fireEvent.click(within(sheet).getByRole('link', { name: 'Pay stubs' }))
    expect(screen.queryByRole('dialog', { name: 'More' })).not.toBeInTheDocument()
    expect(screen.getByText('Page /admin/pay-stubs')).toBeInTheDocument()
    expect(within(tabBar()).getByRole('button', { name: 'More' }).className).toContain('text-primary')
  })

  it('caps the badge at 99+ and shows none at zero', async () => {
    signIn('manager')
    apiMock.getPendingApprovals.mockResolvedValue({ data: { summary: { entry_count: 140 } } })
    const view = renderLayout()
    expect(await within(tabBar()).findByText('99+')).toBeInTheDocument()
    view.unmount()

    apiMock.getPendingApprovals.mockResolvedValue({ data: { summary: { entry_count: 0 } } })
    renderLayout()
    await waitFor(() => expect(apiMock.getPendingApprovals).toHaveBeenCalledTimes(2))
    expect(within(tabBar()).getByRole('link', { name: 'Approvals' })).not.toHaveTextContent(/\d/)
  })

  it('gives employees four tabs and no More when it all fits', () => {
    signIn('employee')
    renderLayout('/admin/my-time')
    expect(names(tabBar())).toEqual(['Clock', 'Hours', 'Leave', 'My Pay'])
    expect(within(tabBar()).getByRole('link', { name: 'Clock' })).toHaveAttribute('aria-current', 'page')
    expect(within(tabBar()).queryByRole('button', { name: 'More' })).not.toBeInTheDocument()
    // Employees never ask for the approvals count.
    expect(apiMock.getPendingApprovals).not.toHaveBeenCalled()
  })

  it('puts Schedule in the fifth slot for employees when it is on', () => {
    signIn('employee', { schedules_enabled: true })
    renderLayout()
    expect(names(tabBar())).toEqual(['Clock', 'Hours', 'Leave', 'My Pay', 'Schedule'])
  })

  it('gives owners and admins a More sheet grouped like the sidebar', () => {
    signIn('admin')
    renderLayout('/admin/settings')
    expect(names(tabBar())).toEqual(['Today', 'Approvals', 'Timecards', 'Payroll'])
    const more = within(tabBar()).getByRole('button', { name: 'More' })
    expect(more).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(more)
    const sheet = screen.getByRole('dialog', { name: 'More' })
    expect(names(within(sheet).getByRole('region', { name: 'Pages' }))).toEqual(['Team', 'Reports', 'Pay stubs'])
    expect(names(within(sheet).getByRole('region', { name: 'Admin' }))).toEqual(['Settings', 'Website', 'Activity'])
    expect(names(within(sheet).getByRole('region', { name: 'Me' }))).toEqual(['My Time', 'My Pay', 'Unlock kiosk'])
    expect(within(sheet).getByRole('link', { name: 'Settings' })).toHaveAttribute('aria-current', 'page')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'More' })).not.toBeInTheDocument()
  })

  it('refreshes the badge when the page changes', async () => {
    signIn('manager')
    apiMock.getPendingApprovals.mockResolvedValue({ data: { summary: { entry_count: 3 } } })
    renderLayout('/admin/approvals')
    await within(tabBar()).findByText('3')
    apiMock.getPendingApprovals.mockResolvedValue({ data: { summary: { entry_count: 2 } } })
    await act(async () => { fireEvent.click(within(tabBar()).getByRole('link', { name: 'Timecards' })) })
    expect(await within(tabBar()).findByText('2')).toBeInTheDocument()
  })
})

describe('AdminLayout kiosk PIN setup', () => {
  beforeEach(() => {
    signIn('employee', { full_name: 'Hourly Pilot', needs_kiosk_pin_setup: true })
  })

  it('blocks a personal time-tracking user until they create a PIN', async () => {
    renderLayout()

    const dialog = screen.getByRole('dialog', { name: /create your kiosk pin/i })
    expect(dialog).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /close/i })).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText(/^pin$/i), { target: { value: '4826' } })
    fireEvent.change(screen.getByLabelText(/confirm pin/i), { target: { value: '4826' } })
    fireEvent.click(screen.getByRole('button', { name: /save kiosk pin/i }))

    await waitFor(() => expect(apiMock.setMyKioskPin).toHaveBeenCalledWith('4826'))
    expect(authMock.value.refreshCurrentUser).toHaveBeenCalledOnce()
  })

  it('does not show the setup flow when the API says no PIN is needed', () => {
    authMock.value.currentUser.needs_kiosk_pin_setup = false
    renderLayout()
    expect(screen.queryByRole('dialog', { name: /create your kiosk pin/i })).not.toBeInTheDocument()
    expect(screen.getByText('Page /admin')).toBeInTheDocument()
  })

  it('renders the local admin workspace without Clerk provider components', () => {
    authMock.value.isClerkEnabled = false
    renderLayout('/admin/payroll')
    expect(screen.getByText('Page /admin/payroll')).toBeInTheDocument()
    expect(screen.queryByText('User menu')).not.toBeInTheDocument()
  })
})
