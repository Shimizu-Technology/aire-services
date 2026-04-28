import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

import AireKiosk from './AireKiosk'

const authMock = vi.hoisted(() => ({
  isClerkEnabled: true,
  isSignedIn: false,
  userRole: null as 'admin' | 'employee' | null,
}))

vi.mock('../../contexts/AuthContext', () => ({
  useAuthContext: () => authMock,
}))

vi.mock('@clerk/clerk-react', () => ({
  SignInButton: ({ children }: { children: React.ReactNode }) => children,
}))

vi.mock('../../lib/api', () => ({
  api: {
    createAdminKioskSession: vi.fn(),
  },
}))

describe('AireKiosk gate', () => {
  it('shows the admin sign-in prompt when signed out', () => {
    authMock.isSignedIn = false
    authMock.userRole = null

    render(
      <MemoryRouter>
        <AireKiosk />
      </MemoryRouter>
    )

    expect(screen.getByRole('button', { name: 'Admin sign in to open kiosk' })).toBeInTheDocument()
  })

  it('shows an admin-only message for signed-in non-admin users', () => {
    authMock.isSignedIn = true
    authMock.userRole = 'employee'

    render(
      <MemoryRouter>
        <AireKiosk />
      </MemoryRouter>
    )

    expect(screen.getByText(/only admins can open this kiosk/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Admin sign in to open kiosk' })).not.toBeInTheDocument()
  })
})
