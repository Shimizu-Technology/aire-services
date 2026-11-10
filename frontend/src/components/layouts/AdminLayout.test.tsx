import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import AdminLayout from './AdminLayout'

const authMock = vi.hoisted(() => ({
  value: {
    isClerkEnabled: true,
    userRole: 'employee' as 'owner' | 'admin' | 'manager' | 'employee',
    currentUser: {
      full_name: 'Hourly Pilot',
      needs_kiosk_pin_setup: true,
    },
    refreshCurrentUser: vi.fn(),
  },
}))

const apiMock = vi.hoisted(() => ({
  setMyKioskPin: vi.fn(),
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

function renderLayout(initialEntry = '/admin') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route element={<AdminLayout />}>
          <Route path="/admin" element={<div>Dashboard content</div>} />
          <Route path="/admin/payroll" element={<div>Payroll content</div>} />
          <Route path="/admin/pay" element={<div>My Pay content</div>} />
          <Route path="/admin/pay/:id" element={<div>Paycheck content</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

describe('AdminLayout kiosk PIN setup', () => {
  beforeEach(() => {
    window.localStorage.clear()
    Object.defineProperty(window, 'innerWidth', { value: 1280, writable: true, configurable: true })
    authMock.value.isClerkEnabled = true
    authMock.value.userRole = 'employee'
    authMock.value.currentUser = {
      full_name: 'Hourly Pilot',
      needs_kiosk_pin_setup: true,
    }
    authMock.value.refreshCurrentUser.mockReset()
    apiMock.setMyKioskPin.mockReset()
    apiMock.setMyKioskPin.mockResolvedValue({ data: { user: {} } })
  })

  it('opens labelled mobile navigation after desktop collapse and restores focus with Escape', () => {
    authMock.value.userRole = 'admin'
    authMock.value.currentUser.needs_kiosk_pin_setup = false
    window.localStorage.setItem('aire-admin-sidebar-collapsed', 'true')
    Object.defineProperty(window, 'innerWidth', { value: 390, writable: true, configurable: true })
    renderLayout()
    const trigger = screen.getByRole('button', { name: 'Toggle sidebar' })
    expect(screen.queryByRole('link', { name: 'Time & Payroll' })).not.toBeInTheDocument()
    fireEvent.click(trigger)
    const dialog = screen.getByRole('dialog', { name: 'Navigation' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(screen.getByRole('link', { name: 'Time & Payroll' })).toHaveTextContent('Time & Payroll')
    expect(screen.getByRole('button', { name: 'Close navigation' })).toHaveFocus()
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveFocus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(screen.getByRole('button', { name: 'Close navigation' })).toHaveFocus()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Navigation' })).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
    expect(document.body.style.overflow).toBe('')
    expect(window.localStorage.getItem('aire-admin-sidebar-collapsed')).toBe('true')
  })

  it('closes mobile navigation on desktop resize and focuses a visible link', () => {
    authMock.value.currentUser.needs_kiosk_pin_setup = false
    window.innerWidth = 390
    renderLayout()
    fireEvent.click(screen.getByRole('button', { name: 'Toggle sidebar' }))
    expect(document.body.style.overflow).toBe('hidden')
    expect(screen.getByRole('button', { name: 'Close navigation' })).toHaveFocus()
    window.innerWidth = 1280
    fireEvent(window, new Event('resize'))
    expect(screen.queryByRole('dialog', { name: 'Navigation' })).not.toBeInTheDocument()
    expect(document.body.style.overflow).toBe('')
    expect(screen.getByRole('link', { name: 'My Dashboard' })).toHaveFocus()
  })

  it('suspends mobile navigation when required PIN setup arrives', () => {
    authMock.value.currentUser.needs_kiosk_pin_setup = false
    window.innerWidth = 390
    const view = renderLayout()
    fireEvent.click(screen.getByRole('button', { name: 'Toggle sidebar' }))
    authMock.value.currentUser = { full_name: 'Hourly Pilot', needs_kiosk_pin_setup: true }
    view.rerender(<MemoryRouter><AdminLayout /></MemoryRouter>)
    expect(screen.queryByRole('dialog', { name: 'Navigation' })).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: /create your kiosk pin/i })).toBeInTheDocument()
    expect(screen.getByLabelText(/^pin$/i)).toHaveFocus()
    expect(document.body.style.overflow).toBe('hidden')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.getByRole('dialog', { name: /create your kiosk pin/i })).toBeInTheDocument()
    view.unmount()
    expect(document.body.style.overflow).toBe('')
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
    expect(screen.getByText('Dashboard content')).toBeInTheDocument()
  })

  it('groups payroll under Time & Payroll navigation for admins', () => {
    authMock.value.userRole = 'admin'
    authMock.value.currentUser.needs_kiosk_pin_setup = false

    renderLayout()

    const workspaceLinks = screen.getAllByRole('link', { name: /time & payroll/i })
    expect(workspaceLinks.length).toBeGreaterThan(0)
    workspaceLinks.forEach((link) => expect(link).toHaveAttribute('href', '/admin/time'))
    expect(screen.queryByRole('link', { name: /payroll runs/i })).not.toBeInTheDocument()
  })

  it('keeps Time & Payroll active on the payroll cutoff route', () => {
    authMock.value.userRole = 'admin'
    authMock.value.currentUser.needs_kiosk_pin_setup = false

    renderLayout('/admin/payroll')

    const workspaceLinks = screen.getAllByRole('link', { name: /time & payroll/i })
    expect(workspaceLinks.some((link) => link.classList.contains('bg-cyan-50'))).toBe(true)
    expect(screen.getByText('Payroll content')).toBeInTheDocument()
  })

  it('keeps employee navigation focused on My Time', () => {
    authMock.value.currentUser.needs_kiosk_pin_setup = false

    renderLayout()

    expect(screen.getAllByRole('link', { name: /my time/i }).length).toBeGreaterThan(0)
    expect(screen.queryByRole('link', { name: /time & payroll/i })).not.toBeInTheDocument()
  })

  it('renders the local admin workspace without Clerk provider components', () => {
    authMock.value.isClerkEnabled = false
    authMock.value.currentUser.needs_kiosk_pin_setup = false

    renderLayout('/admin/payroll')

    expect(screen.getByText('Payroll content')).toBeInTheDocument()
    expect(screen.queryByText('User menu')).not.toBeInTheDocument()
  })
})

describe('AdminLayout My Pay navigation', () => {
  beforeEach(() => {
    window.localStorage.clear()
    Object.defineProperty(window, 'innerWidth', { value: 1280, writable: true, configurable: true })
    authMock.value.isClerkEnabled = true
  })

  it.each(['employee', 'manager', 'admin', 'owner'] as const)('shows My Pay to an enabled %s', (role) => {
    authMock.value.userRole = role
    authMock.value.currentUser = { full_name: 'Pilot Worker', needs_kiosk_pin_setup: false, my_pay_enabled: true } as typeof authMock.value.currentUser
    renderLayout()
    expect(screen.getByRole('link', { name: 'My Pay' })).toHaveAttribute('href', '/admin/pay')
  })

  it.each(['employee', 'manager', 'admin', 'owner'] as const)('hides My Pay from a %s whose switch is off', (role) => {
    authMock.value.userRole = role
    authMock.value.currentUser = { full_name: 'Other Worker', needs_kiosk_pin_setup: false, my_pay_enabled: false } as typeof authMock.value.currentUser
    renderLayout()
    expect(screen.queryByRole('link', { name: 'My Pay' })).not.toBeInTheDocument()
  })

  it.each([
    ['/admin/pay', 'My Pay'],
    ['/admin/pay/42', 'My Pay'],
    ['/admin/payroll', 'Time & Payroll'],
  ])('highlights only the matching menu item on %s', (path, active) => {
    authMock.value.userRole = 'admin'
    authMock.value.currentUser = { full_name: 'Pilot Admin', needs_kiosk_pin_setup: false, my_pay_enabled: true } as typeof authMock.value.currentUser
    renderLayout(path)
    const current = screen.getAllByRole('link').filter((link) => link.getAttribute('aria-current') === 'page')
    expect(current.map((link) => link.textContent)).toEqual([active])
  })
})

describe('AdminLayout navigation by role', () => {
  beforeEach(() => {
    window.localStorage.clear()
    Object.defineProperty(window, 'innerWidth', { value: 1280, writable: true, configurable: true })
    authMock.value.isClerkEnabled = true
    authMock.value.currentUser = { full_name: 'Team Member', needs_kiosk_pin_setup: false, my_pay_enabled: true } as typeof authMock.value.currentUser
  })

  function navLabels() {
    const nav = screen.getAllByRole('navigation')[0]
    return Array.from(nav.querySelectorAll('a')).map((link) => link.textContent?.trim())
  }

  it.each([
    ['owner', ['Dashboard', 'My Pay', 'Time & Payroll', 'Schedule', 'Team', 'Media', 'Activity History', 'Settings']],
    ['admin', ['Dashboard', 'My Pay', 'Time & Payroll', 'Schedule', 'Team', 'Media', 'Activity History', 'Settings']],
    ['manager', ['Dashboard', 'Time & Payroll', 'My Pay', 'Schedule']],
    ['employee', ['My Dashboard', 'My Time', 'My Pay', 'Schedule']],
  ] as const)('gives a %s exactly their menu', (role, expected) => {
    authMock.value.userRole = role
    renderLayout()
    expect(navLabels()).toEqual(expected)
  })

  it('labels the manager workspace without calling it admin', () => {
    authMock.value.userRole = 'manager'
    renderLayout()
    expect(screen.getByText('Manager workspace')).toBeInTheDocument()
    expect(screen.queryByText('Admin workspace')).not.toBeInTheDocument()
  })
})
