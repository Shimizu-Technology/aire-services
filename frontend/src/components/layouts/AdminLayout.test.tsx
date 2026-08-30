import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import AdminLayout from './AdminLayout'

const authMock = vi.hoisted(() => ({
  value: {
    isClerkEnabled: true,
    userRole: 'employee' as 'employee' | 'admin',
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
  SignedIn: ({ children }: { children: ReactNode }) => <>{children}</>,
  UserButton: () => <div>User menu</div>,
}))

function renderLayout() {
  return render(
    <MemoryRouter initialEntries={['/admin']}>
      <Routes>
        <Route element={<AdminLayout />}>
          <Route path="/admin" element={<div>Dashboard content</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

describe('AdminLayout kiosk PIN setup', () => {
  beforeEach(() => {
    authMock.value.userRole = 'employee'
    authMock.value.currentUser = {
      full_name: 'Hourly Pilot',
      needs_kiosk_pin_setup: true,
    }
    authMock.value.refreshCurrentUser.mockReset()
    apiMock.setMyKioskPin.mockReset()
    apiMock.setMyKioskPin.mockResolvedValue({ data: { user: {} } })
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

  it('keeps employee navigation focused on My Time', () => {
    authMock.value.currentUser.needs_kiosk_pin_setup = false

    renderLayout()

    expect(screen.getAllByRole('link', { name: /my time/i }).length).toBeGreaterThan(0)
    expect(screen.queryByRole('link', { name: /time & payroll/i })).not.toBeInTheDocument()
  })
})
