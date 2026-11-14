import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ClerkProtectedContent from './ClerkProtectedContent'

const authMock = vi.hoisted(() => ({
  clerk: {
    isLoaded: true,
    isSignedIn: true,
  },
  user: {
    primaryEmailAddress: { emailAddress: 'staff@example.com' },
  },
  app: {
    userRole: 'admin' as 'owner' | 'admin' | 'manager' | 'employee' | null,
    isLoading: false,
    isStaff: true,
    authError: null as string | null,
    isAuthServiceUnavailable: false,
    refreshCurrentUser: vi.fn().mockResolvedValue(undefined),
  },
}))

vi.mock('@clerk/clerk-react', () => ({
  useAuth: () => authMock.clerk,
  useUser: () => ({ user: authMock.user }),
  RedirectToSignIn: () => <div>Sign in</div>,
}))

vi.mock('../../contexts/AuthContext', () => ({
  useAuthContext: () => authMock.app,
}))

describe('ClerkProtectedContent', () => {
  beforeEach(() => {
    authMock.clerk.isLoaded = true
    authMock.clerk.isSignedIn = true
    authMock.app.userRole = 'admin'
    authMock.app.isLoading = false
    authMock.app.isStaff = true
    authMock.app.authError = null
    authMock.app.isAuthServiceUnavailable = false
    authMock.app.refreshCurrentUser.mockClear()
  })

  it('shows a retryable service message when staff verification is unavailable', () => {
    authMock.app.isAuthServiceUnavailable = true

    render(<ClerkProtectedContent requiredCapability="manage_settings"><div>Admin content</div></ClerkProtectedContent>)

    expect(screen.getByRole('heading', { name: /aire is temporarily unavailable/i })).toBeInTheDocument()
    expect(screen.queryByText('Access Denied')).not.toBeInTheDocument()
    expect(screen.queryByText('Admin content')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /retry connection/i }))
    expect(authMock.app.refreshCurrentUser).toHaveBeenCalledOnce()
  })

  it('keeps true authorization failures distinct from outages', () => {
    authMock.app.userRole = null
    authMock.app.isStaff = false
    authMock.app.authError = 'This account does not have staff access'

    render(<ClerkProtectedContent requiredCapability="manage_settings"><div>Admin content</div></ClerkProtectedContent>)

    expect(screen.getByRole('heading', { name: /access denied/i })).toBeInTheDocument()
    expect(screen.getByText('This account does not have staff access')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /retry connection/i })).not.toBeInTheDocument()
  })

  it('renders protected content after the user is verified', () => {
    render(<ClerkProtectedContent requiredCapability="manage_settings"><div>Admin content</div></ClerkProtectedContent>)

    expect(screen.getByText('Admin content')).toBeInTheDocument()
  })

  it('lets owners into every admin page', () => {
    authMock.app.userRole = 'owner'
    render(<ClerkProtectedContent requiredCapability="manage_users"><div>Team</div></ClerkProtectedContent>)

    expect(screen.getByText('Team')).toBeInTheDocument()
  })

  it('keeps managers out of admin-only pages but lets them into the day-to-day ones', () => {
    authMock.app.userRole = 'manager'
    const { unmount } = render(<ClerkProtectedContent requiredCapability="manage_payroll"><div>Payroll</div></ClerkProtectedContent>)

    expect(screen.getByRole('heading', { name: /access denied/i })).toBeInTheDocument()
    expect(screen.queryByText('Payroll')).not.toBeInTheDocument()
    unmount()

    render(<ClerkProtectedContent requiredCapability="approve_time"><div>Approvals</div></ClerkProtectedContent>)
    expect(screen.getByText('Approvals')).toBeInTheDocument()
  })

  it.each([
    ['manager', 'Back to Approvals', '/admin/approvals'],
    ['employee', 'Open My Time', '/admin/my-time'],
  ] as const)('sends a denied %s back to their own work area, with the public site as a small link (N6)', (role, label, href) => {
    authMock.app.userRole = role
    render(<ClerkProtectedContent requiredCapability="manage_settings"><div>Settings</div></ClerkProtectedContent>)
    expect(screen.getByRole('heading', { name: 'Access Denied' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: label })).toHaveAttribute('href', href)
    expect(screen.queryByRole('link', { name: 'Return to Home' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'View public website' })).toHaveAttribute('href', '/')
  })

  it('names the owner and admin work area too', () => {
    authMock.app.userRole = 'admin'
    authMock.app.authError = 'Your account was disabled.'
    render(<ClerkProtectedContent><div>Admin</div></ClerkProtectedContent>)
    expect(screen.getByRole('link', { name: 'Back to Today' })).toHaveAttribute('href', '/admin')
  })

  it('offers only the public website when the account has no role at all', () => {
    authMock.app.userRole = null
    render(<ClerkProtectedContent><div>Admin</div></ClerkProtectedContent>)
    expect(screen.getByRole('link', { name: 'View public website' })).toHaveAttribute('href', '/')
    expect(screen.queryByRole('link', { name: /Back to|Open My Time/ })).not.toBeInTheDocument()
  })
})
