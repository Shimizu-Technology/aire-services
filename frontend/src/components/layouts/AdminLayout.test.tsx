import '@testing-library/jest-dom'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useState } from 'react'
import AdminLayout from './AdminLayout'
import { Button, SelectionBar, useToast } from '../ui'

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
  useClerk: () => ({ openUserProfile: vi.fn(), signOut: vi.fn() }),
  UserButton: Object.assign(
    ({ children }: { children: ReactNode }) => <div>User menu{children}</div>,
    {
      MenuItems: ({ children }: { children: ReactNode }) => <>{children}</>,
      Action: ({ label, onClick }: { label: string; onClick: () => void }) => <button onClick={onClick}>{label}</button>,
    },
  ),
}))

const PAGES = ['/admin', '/admin/approvals', '/admin/leave', '/admin/timecards', '/admin/reports', '/admin/payroll', '/admin/pay', '/admin/pay/:id', '/admin/pay-stubs', '/admin/users', '/admin/settings', '/admin/website/media', '/admin/my-time', '/admin/my-hours', '/admin/schedule', '/admin/activity', '/admin/settings/roles']

function layoutTree(initialEntry = '/admin') {
  return (
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route element={<AdminLayout />}>
          {PAGES.map((path) => <Route key={path} path={path} element={<div>{`Page ${path}`}</div>} />)}
        </Route>
      </Routes>
    </MemoryRouter>
  )
}

function renderLayout(initialEntry = '/admin') {
  return render(layoutTree(initialEntry))
}

// Happy DOM has no layout, so the dialog focus trap would see no visible controls.
function withLayoutBoxes() {
  return vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([new DOMRect(0, 0, 100, 44)] as unknown as DOMRectList)
}

function setViewportWidth(width: number) {
  Object.defineProperty(window, 'innerWidth', { value: width, writable: true, configurable: true })
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

const initialViewportWidth = window.innerWidth
afterEach(() => setViewportWidth(initialViewportWidth))

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
    expect(groupNames('Me')).toEqual(['My Time', 'My Pay', 'Unlock kiosk', 'What can I do?'])
    expect(within(sidebar()).queryByRole('group', { name: 'Admin' })).not.toBeInTheDocument()
    expect(screen.getByText('Manager workspace', { selector: 'div' })).toBeInTheDocument()
  })

  it('gives employees their own time only', () => {
    signIn('employee')
    renderLayout()
    expect(groupNames('Workspace')).toEqual(['Clock', 'My Hours', 'Leave', 'My Pay'])
    expect(within(sidebar()).queryByRole('group', { name: 'Me' })).not.toBeInTheDocument()
  })

  it.each(['manager'] as const)('opens "What can I do?" for a %s and marks it current there', (role) => {
    signIn(role)
    renderLayout('/admin/settings/roles')
    const link = within(sidebar()).getByRole('link', { name: 'What can I do?' })
    expect(link).toHaveAttribute('href', '/admin/settings/roles')
    expect(link).toHaveAttribute('aria-current', 'page')
  })

  it.each(['owner', 'admin'] as const)('leaves "What can I do?" out for a %s, who opens Roles & access from Settings', (role) => {
    signIn(role)
    renderLayout('/admin/settings/roles')
    expect(screen.queryByRole('link', { name: 'What can I do?' })).not.toBeInTheDocument()
    const current = within(sidebar()).getAllByRole('link').filter((link) => link.getAttribute('aria-current') === 'page')
    expect(current.map((link) => link.getAttribute('aria-label'))).toEqual(['Settings'])
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
    ['manager', 'Me', ['My Time', 'My Pay', 'Schedule', 'Unlock kiosk', 'What can I do?']],
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
    expect(names(sheet)).toEqual(['Pay stubs', 'My Pay', 'Unlock kiosk', 'What can I do?'])
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

  it('gives employees four tabs and help in the account menu', () => {
    signIn('employee')
    renderLayout('/admin/my-time')
    expect(names(tabBar())).toEqual(['Clock', 'Hours', 'Leave', 'My Pay'])
    expect(within(tabBar()).queryByRole('button', { name: 'More' })).not.toBeInTheDocument()
    const account = screen.getByRole('button', { name: 'Account menu' })
    fireEvent.click(account)
    fireEvent.click(screen.getByRole(account.getAttribute('aria-haspopup') === 'menu' ? 'menuitem' : 'button', { name: 'What can I do?' }))
    expect(screen.getByText('Page /admin/settings/roles')).toBeInTheDocument()
    expect(apiMock.getPendingApprovals).not.toHaveBeenCalled()
  })

  it.each([false, true])('puts Schedule in an employee tab with My Pay %s', (pay) => {
    signIn('employee', { my_pay_enabled: pay, schedules_enabled: true })
    renderLayout()
    expect(names(tabBar())).toEqual(pay
      ? ['Clock', 'Hours', 'Leave', 'My Pay', 'Schedule']
      : ['Clock', 'Hours', 'Leave', 'Schedule'])
    expect(within(tabBar()).queryByRole('button', { name: 'More' })).not.toBeInTheDocument()
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

  it('refreshes the badge every minute, and not while the browser tab is hidden', async () => {
    vi.useFakeTimers()
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    try {
      signIn('manager')
      renderLayout('/admin/approvals')
      await act(async () => { await vi.advanceTimersByTimeAsync(0) })
      expect(apiMock.getPendingApprovals).toHaveBeenCalledTimes(1)

      await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
      expect(apiMock.getPendingApprovals).toHaveBeenCalledTimes(2)

      visibility.mockReturnValue('hidden')
      await act(async () => { await vi.advanceTimersByTimeAsync(120_000) })
      expect(apiMock.getPendingApprovals).toHaveBeenCalledTimes(2)
    } finally {
      visibility.mockRestore()
      vi.useRealTimers()
    }
  })

  it('keeps focus inside More, closes it with Escape and returns to the More button', () => {
    const boxes = withLayoutBoxes()
    try {
      signIn('manager')
      renderLayout('/admin/approvals')
      const more = within(tabBar()).getByRole('button', { name: 'More' })
      more.focus()
      fireEvent.click(more)
      const sheet = screen.getByRole('dialog', { name: 'More' })
      expect(sheet).toHaveAttribute('aria-modal', 'true')
      expect(more).toHaveAttribute('aria-expanded', 'true')
      const close = within(sheet).getByRole('button', { name: 'Close' })
      expect(close).toHaveFocus()

      fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
      expect(within(sheet).getByRole('link', { name: 'What can I do?' })).toHaveFocus()
      fireEvent.keyDown(document, { key: 'Tab' })
      expect(close).toHaveFocus()

      fireEvent.keyDown(document, { key: 'Escape' })
      expect(screen.queryByRole('dialog', { name: 'More' })).not.toBeInTheDocument()
      expect(more).toHaveFocus()
      expect(more).toHaveAttribute('aria-expanded', 'false')
      expect(document.body.style.overflow).toBe('')
    } finally {
      boxes.mockRestore()
    }
  })

  it('closes More when the window grows to desktop width and continues from the sidebar', () => {
    const boxes = withLayoutBoxes()
    try {
      setViewportWidth(390)
      signIn('admin')
      renderLayout('/admin/settings')
      fireEvent.click(within(tabBar()).getByRole('button', { name: 'More' }))
      expect(document.body.style.overflow).toBe('hidden')

      // Still a phone: the sheet stays.
      setViewportWidth(700)
      fireEvent(window, new Event('resize'))
      expect(screen.getByRole('dialog', { name: 'More' })).toBeInTheDocument()

      setViewportWidth(1280)
      fireEvent(window, new Event('resize'))
      expect(screen.queryByRole('dialog', { name: 'More' })).not.toBeInTheDocument()
      expect(document.body.style.overflow).toBe('')
      expect(within(sidebar()).getByRole('link', { name: 'Settings' })).toHaveFocus()
    } finally {
      boxes.mockRestore()
    }
  })

  it('locks the tab bar and More while required kiosk PIN setup is open', () => {
    signIn('manager')
    const view = renderLayout('/admin/approvals')
    fireEvent.click(within(tabBar()).getByRole('button', { name: 'More' }))
    expect(screen.getByRole('dialog', { name: 'More' })).toBeInTheDocument()

    authMock.value.currentUser = { ...authMock.value.currentUser, needs_kiosk_pin_setup: true }
    view.rerender(layoutTree('/admin/approvals'))
    expect(screen.queryByRole('dialog', { name: 'More' })).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: /create your kiosk pin/i })).toBeInTheDocument()
    expect(screen.getByLabelText(/^pin$/i)).toHaveFocus()
    const lockedTabs = screen.getByRole('navigation', { name: 'Main tabs', hidden: true })
    expect(lockedTabs).toHaveAttribute('inert')

    fireEvent.click(within(lockedTabs).getByRole('button', { name: 'More', hidden: true }))
    expect(screen.queryByRole('dialog', { name: 'More' })).not.toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.getByRole('dialog', { name: /create your kiosk pin/i })).toBeInTheDocument()

    // Once the PIN is saved the bar works again, and More doesn't pop back open.
    authMock.value.currentUser = { ...authMock.value.currentUser, needs_kiosk_pin_setup: false }
    view.rerender(layoutTree('/admin/approvals'))
    expect(tabBar()).not.toHaveAttribute('inert')
    expect(screen.queryByRole('dialog', { name: 'More' })).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: /create your kiosk pin/i })).not.toBeInTheDocument()
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

describe('My Pay and Payroll navigation', () => {
  // Every My Pay link the person can reach: sidebar, tab bar and the More sheet.
  function myPayLinks() {
    const more = within(tabBar()).queryByRole('button', { name: 'More' })
    if (more) fireEvent.click(more)
    return screen.queryAllByRole('link', { name: 'My Pay' })
  }

  it.each(['employee', 'manager', 'admin', 'owner'] as const)('shows My Pay to a %s only while their My Pay switch is on', (role) => {
    signIn(role, { my_pay_enabled: true })
    const view = renderLayout()
    expect(within(sidebar()).getByRole('link', { name: 'My Pay' })).toHaveAttribute('href', '/admin/pay')
    const links = myPayLinks()
    expect(links.length).toBeGreaterThanOrEqual(2)
    links.forEach((link) => expect(link).toHaveAttribute('href', '/admin/pay'))
    view.unmount()

    signIn(role, { my_pay_enabled: false })
    renderLayout()
    expect(myPayLinks()).toHaveLength(0)
  })

  it.each(['owner', 'admin'] as const)('gives a %s Payroll in the sidebar and the tab bar', (role) => {
    signIn(role)
    renderLayout('/admin/payroll')
    for (const nav of [sidebar(), tabBar()]) {
      const payroll = within(nav).getByRole('link', { name: 'Payroll' })
      expect(payroll).toHaveAttribute('href', '/admin/payroll')
      expect(payroll).toHaveAttribute('aria-current', 'page')
    }
  })

  it.each(['manager', 'employee'] as const)('keeps Payroll out of a %s’s navigation', (role) => {
    signIn(role)
    renderLayout()
    const more = within(tabBar()).queryByRole('button', { name: 'More' })
    if (more) fireEvent.click(more)
    expect(screen.queryByRole('link', { name: 'Payroll' })).not.toBeInTheDocument()
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

function SelectionPage() {
  const [count, setCount] = useState(0)
  const toast = useToast()
  return (
    <>
      <button type="button" onClick={() => setCount(value => value + 1)}>Select a shift</button>
      <button type="button" onClick={() => toast.show({ message: 'Approved 2 shifts for Marcus Quinata', action: { label: 'Undo', onAction: () => undefined } })}>Approve 2</button>
      <SelectionBar count={count} noun={['shift', 'shifts']} label="Selected shifts" onClear={() => setCount(0)} actions={<Button>{`Approve ${count}`}</Button>} />
    </>
  )
}

describe('AdminLayout selection bar and toasts', () => {
  const renderSelectionPage = () => render(
    <MemoryRouter initialEntries={['/admin/approvals']}>
      <Routes>
        <Route element={<AdminLayout />}>
          <Route path="/admin/approvals" element={<SelectionPage />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )

  it('swaps the phone tab bar for the selection bar while something is selected', () => {
    signIn('manager')
    setViewportWidth(390)
    renderSelectionPage()
    expect(tabBar()).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Select a shift' }))
    expect(screen.getByRole('region', { name: 'Selected shifts' })).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Main tabs' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(screen.queryByRole('region', { name: 'Selected shifts' })).not.toBeInTheDocument()
    expect(tabBar()).toBeVisible()
  })

  it('gives every admin page a toast region', () => {
    signIn('manager')
    renderSelectionPage()
    fireEvent.click(screen.getByRole('button', { name: 'Approve 2' }))
    expect(screen.getByRole('status')).toHaveTextContent('Approved 2 shifts for Marcus Quinata')
    expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument()
  })

  it('marks the current sidebar item in navy, not cyan', () => {
    signIn('manager')
    renderSelectionPage()
    const current = within(sidebar()).getByRole('link', { name: /Approvals/ })
    expect(current).toHaveAttribute('aria-current', 'page')
    expect(current).toHaveClass('text-primary', 'shadow-[inset_3px_0_0_var(--color-primary)]')
    expect(current.className).not.toMatch(/cyan/)
  })
})

