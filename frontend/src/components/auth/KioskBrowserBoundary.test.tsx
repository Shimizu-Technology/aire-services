import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Outlet, Route, Routes } from 'react-router-dom'
import { afterEach, expect, it } from 'vitest'
import { KioskBrowserBoundary } from './KioskBrowserBoundary'
import { clearKioskSession, storeKioskSession } from '../../lib/kioskSession'

afterEach(clearKioskSession)

function open() {
  render(<MemoryRouter initialEntries={['/admin']}><Routes>
    <Route element={<KioskBrowserBoundary><Outlet /></KioskBrowserBoundary>}>
      <Route path="/admin" element={<button>Manager sign in</button>} />
      <Route path="/kiosk" element={<h1>Manager PIN required to lock</h1>} />
    </Route>
  </Routes></MemoryRouter>)
}

it('routes a browser with an active device to the kiosk before showing manager sign-in', async () => {
  storeKioskSession({ token: 'device', expiresAt: '2099-01-01T00:00:00Z', unlockedBy: 'Roke' })
  open()
  await screen.findByRole('heading', { name: 'Manager PIN required to lock' })
  expect(screen.queryByRole('button', { name: 'Manager sign in' })).not.toBeInTheDocument()
})

it('allows manager sign-in after the device session expires', () => {
  storeKioskSession({ token: 'expired', expiresAt: '2000-01-01T00:00:00Z', unlockedBy: 'Roke' })
  open()
  expect(screen.getByRole('button', { name: 'Manager sign in' })).toBeInTheDocument()
})

it('restricts an already-open workspace when another tab unlocks this browser', async () => {
  open()
  storeKioskSession({ token: 'device', expiresAt: '2099-01-01T00:00:00Z', unlockedBy: 'Roke' })
  fireEvent(window, new Event('storage'))
  await screen.findByRole('heading', { name: 'Manager PIN required to lock' })
  expect(screen.queryByRole('button', { name: 'Manager sign in' })).not.toBeInTheDocument()
})
