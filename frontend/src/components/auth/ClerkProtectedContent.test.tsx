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
    userRole: 'admin' as 'admin' | 'employee' | null,
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

    render(<ClerkProtectedContent requiredRole="admin"><div>Admin content</div></ClerkProtectedContent>)

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

    render(<ClerkProtectedContent requiredRole="admin"><div>Admin content</div></ClerkProtectedContent>)

    expect(screen.getByRole('heading', { name: /access denied/i })).toBeInTheDocument()
    expect(screen.getByText('This account does not have staff access')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /retry connection/i })).not.toBeInTheDocument()
  })

  it('renders protected content after the user is verified', () => {
    render(<ClerkProtectedContent requiredRole="admin"><div>Admin content</div></ClerkProtectedContent>)

    expect(screen.getByText('Admin content')).toBeInTheDocument()
  })
})
