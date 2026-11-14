import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'
import { mockMatchMedia } from '../../test/matchMedia'
import { AccountButton } from './Header'

const clerk = vi.hoisted(() => ({ openUserProfile: vi.fn(), signOut: vi.fn() }))
vi.mock('@clerk/clerk-react', () => ({
  useClerk: () => clerk,
  UserButton: () => <span>Clerk account</span>,
}))
vi.mock('../../contexts/AuthContext', () => ({
  useAuthContext: () => ({
    userRole: 'employee',
    currentUser: { full_name: 'Ethan Cruz' },
  }),
}))
let restore = () => {}
afterEach(() => {
  restore()
  vi.clearAllMocks()
})
const open = (width: number) => {
  restore = mockMatchMedia({ width })
  render(
    <MemoryRouter>
      <Routes>
        <Route path="/" element={<AccountButton />} />
        <Route path="/admin/settings/roles" element={<p>Roles and access</p>} />
      </Routes>
    </MemoryRouter>,
  )
  const trigger = screen.getByRole('button', { name: 'Account menu' })
  expect(trigger).toHaveClass('size-11')
  expect(trigger).toHaveTextContent('EC')
  fireEvent.click(trigger)
}

it.each([390, 1280])(
  'opens the avatar menu at %ipx and keeps help/account/sign out',
  (width) => {
    open(width)
    expect(screen.getByRole(width < 1024 ? 'dialog' : 'menu')).toBeInTheDocument()
    const role = width < 1024 ? 'button' : 'menuitem'
    expect(screen.getByRole(role, { name: 'Manage account' })).toBeInTheDocument()
    expect(screen.getByRole(role, { name: 'Sign out' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole(role, { name: 'What can I do?' }))
    expect(screen.getByText('Roles and access')).toBeInTheDocument()
  },
)

it('opens the existing Clerk profile action', () => {
  open(1280)
  fireEvent.click(screen.getByRole('menuitem', { name: 'Manage account' }))
  expect(clerk.openUserProfile).toHaveBeenCalledOnce()
})

it('signs out through Clerk and returns to the public site', () => {
  open(390)
  fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
  expect(clerk.signOut).toHaveBeenCalledWith({ redirectUrl: '/' })
})
