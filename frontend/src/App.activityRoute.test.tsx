import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import { Outlet } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'


vi.mock('./contexts/AuthContext', () => ({ useAuthContext: () => ({ isClerkEnabled: true, userRole: 'manager', isStaff: true, currentUser: { id: 7 } }) }))
vi.mock('@clerk/clerk-react', () => ({ useAuth: () => ({ isLoaded: true, isSignedIn: true }), useUser: () => ({ user: {} }) }))
vi.mock('./providers/PostHogProvider', () => ({ PostHogPageView: () => null }))
vi.mock('./components/layouts/AdminLayout', () => ({ default: () => <Outlet /> }))
vi.mock('./pages/admin/ActivityHistory', () => ({ default: () => <h1>Shift history</h1> }))
afterEach(cleanup)
it('opens a manager shift history route', async () => {
  window.history.pushState({}, '', '/admin/activity?subject_type=TimeEntry&subject_id=42')
  vi.resetModules()
  const { default: App } = await import('./App')
  render(<App />)
  expect(await screen.findByRole('heading', { name: 'Shift history' })).toBeInTheDocument()
})
it.each(['', '?subject_type=User&subject_id=42', '?subject_type=TimeEntry&subject_id=oops'])('denies manager Activity list %s', async query => {
  window.history.pushState({}, '', `/admin/activity${query}`)
  vi.resetModules()
  const { default: App } = await import('./App')
  render(<App />)
  expect(await screen.findByRole('heading', { name: 'Access denied' })).toBeInTheDocument()
})
