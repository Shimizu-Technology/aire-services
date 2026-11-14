import '@testing-library/jest-dom'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { useContext, useState } from 'react'
import { Link, Outlet, UNSAFE_DataRouterContext, useBlocker, useLocation } from 'react-router-dom'
import { afterAll, describe, expect, it, vi } from 'vitest'

import App from './App'

vi.mock('./contexts/AuthContext', () => ({
  useAuthContext: () => ({ isClerkEnabled: true, userRole: 'admin', currentUser: { id: 1 } }),
}))
vi.mock('./providers/PostHogProvider', () => ({ PostHogPageView: () => null }))
vi.mock('./components/auth/ProtectedRoute', () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }))
vi.mock('./components/layouts/AdminLayout', () => ({
  default: () => (
    <>
      <Link to="/admin/users">Team</Link>
      <Link to="/admin/settings">Settings</Link>
      <Link to="/admin/settings?section=approvals">Approvals section</Link>
      <Outlet />
    </>
  ),
}))
vi.mock('./pages/admin/Users', () => ({ default: () => <h1>Team page</h1> }))
// Stands in for a page that guards a draft, as useUnsavedChanges does: it
// needs the data router context, then blocks moves to another page.
vi.mock('./pages/admin/settings/SettingsHome', () => ({
  default: function DraftPage() {
    const dataRouter = useContext(UNSAFE_DataRouterContext)
    const location = useLocation()
    const [dirty, setDirty] = useState(false)
    const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname)
    return (
      <>
        <h1>Settings page</h1>
        <p data-testid="router">{dataRouter ? 'data router' : 'no data router'}</p>
        <p data-testid="search">{location.search}</p>
        <button type="button" onClick={() => setDirty(true)}>Edit</button>
        {blocker.state === 'blocked' && (
          <div role="alertdialog" aria-label="Leave without saving?">
            <button type="button" onClick={() => blocker.reset?.()}>Keep editing</button>
            <button type="button" onClick={() => blocker.proceed?.()}>Discard changes</button>
          </div>
        )}
      </>
    )
  },
}))

afterAll(() => window.history.pushState({}, '', '/'))

describe('App router', () => {
  it('is a data router, so a page can block in-app navigation with unsaved changes', async () => {
    window.history.pushState({}, '', '/admin/users')
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'Team page' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('link', { name: 'Settings' }))
    expect(await screen.findByRole('heading', { name: 'Settings page' })).toBeInTheDocument()
    expect(screen.getByTestId('router')).toHaveTextContent('data router')

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    // Back to Team asks first, and Keep editing stays.
    await act(async () => { window.history.back(); await new Promise(resolve => setTimeout(resolve, 20)) })
    expect(await screen.findByRole('alertdialog', { name: 'Leave without saving?' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }))
    expect(screen.getByRole('heading', { name: 'Settings page' })).toBeInTheDocument()
    expect(window.location.pathname).toBe('/admin/settings')

    // Same page, different query: free.
    fireEvent.click(screen.getByRole('link', { name: 'Approvals section' }))
    expect(screen.getByTestId('search')).toHaveTextContent('?section=approvals')
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('link', { name: 'Team' }))
    expect(await screen.findByRole('alertdialog', { name: 'Leave without saving?' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }))
    expect(window.location.pathname).toBe('/admin/settings')

    fireEvent.click(screen.getByRole('link', { name: 'Team' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Discard changes' }))
    expect(await screen.findByRole('heading', { name: 'Team page' })).toBeInTheDocument()
    expect(window.location.pathname).toBe('/admin/users')
  })
})
