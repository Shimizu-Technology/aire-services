import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
import AireKiosk from './AireKiosk'

const authMock = vi.hoisted(() => ({ isClerkEnabled: true, isSignedIn: true, userRole: 'admin' as 'admin' | 'employee' | null }))
const mocks = vi.hoisted(() => ({ createAdminKioskSession: vi.fn(), getPayrollCutoff: vi.fn(), aireKioskVerify: vi.fn(), aireKioskClockIn: vi.fn(), aireKioskClockOut: vi.fn() }))
vi.mock('../../lib/api', () => ({ api: mocks }))
vi.mock('../../contexts/AuthContext', () => ({ useAuthContext: () => authMock }))
vi.mock('@clerk/clerk-react', () => ({ SignInButton: ({ children }: { children: React.ReactNode }) => children }))
vi.mock('../../components/time-tracking/PayrollCutoffNotice', () => ({ default: ({ kiosk }: { kiosk: { notice: unknown } }) => <div data-testid="warning">{kiosk.notice ? 'notice' : 'none'}</div> }))

const employee = { id: 1, display_name: 'Avery', full_name: 'Avery Fixture' }
const category = { id: 1, name: 'Ground operations' }
const idle = { clocked_in: false, can_clock_in: true, time_category: null }
const working = { clocked_in: true, status: 'clocked_in', time_category: category }

beforeEach(() => {
  vi.clearAllMocks()
  authMock.isSignedIn = true
  authMock.userRole = 'admin'
  sessionStorage.setItem('aire_kiosk_access_session', JSON.stringify({ token: 'access', expiresAt: '2099-01-01T00:00:00Z', unlockedBy: 'QA' }))
  mocks.aireKioskVerify.mockResolvedValue({ data: { employee, kiosk_token: 'employee-token', current_status: idle, available_categories: [category] } })
  mocks.aireKioskClockIn.mockResolvedValue({ data: { employee, current_status: working, available_categories: [category], time_entry: { time_category: category } } })
  mocks.aireKioskClockOut.mockResolvedValue({ data: { employee, current_status: idle, available_categories: [category], time_entry: { time_category: category } } })
})

it('does not wait for warning reads to finish clocking and ignores reads superseded by actions or reset', async () => {
  const pending: Array<(response: { data: unknown }) => void> = []
  mocks.getPayrollCutoff.mockImplementation(() => new Promise(resolve => pending.push(resolve)))
  render(<MemoryRouter><AireKiosk /></MemoryRouter>)
  for (const digit of '1234') fireEvent.click(screen.getByRole('button', { name: digit }))
  fireEvent.click(screen.getByRole('button', { name: 'Verify PIN' }))
  const clockIn = screen.getByRole('button', { name: 'Clock In' })
  await waitFor(() => expect(clockIn).toBeEnabled())
  expect(mocks.getPayrollCutoff).toHaveBeenCalledWith('access', 'employee-token')
  fireEvent.click(clockIn)
  await screen.findByText('Avery clocked in for Ground operations.')
  await act(async () => { pending[0]({ data: { cutoff: {}, acknowledged: false } }) })
  expect(screen.getByTestId('warning')).toHaveTextContent('none')
  fireEvent.click(screen.getByRole('button', { name: 'Clock Out' }))
  await screen.findByText('Avery clocked out successfully.')
  expect(mocks.aireKioskClockIn).toHaveBeenCalledOnce()
  expect(mocks.aireKioskClockOut).toHaveBeenCalledOnce()
  fireEvent.click(screen.getByRole('button', { name: 'Not you? Reset' }))
  await act(async () => { for (const resolve of pending.slice(1)) resolve({ data: { cutoff: {}, acknowledged: false } }) })
  expect(screen.getByText('Waiting for PIN')).toBeInTheDocument()
  expect(screen.getByTestId('warning')).toHaveTextContent('none')
})

// Preserve the existing shared-device access gates alongside the warning race test.
it('shows the admin sign-in prompt when signed out', () => {
  sessionStorage.clear()
  authMock.isSignedIn = false
  authMock.userRole = null
  render(<MemoryRouter><AireKiosk /></MemoryRouter>)
  expect(screen.getByRole('button', { name: 'Admin sign in to open kiosk' })).toBeInTheDocument()
})

it('shows an admin-only message for signed-in non-admin users', () => {
  sessionStorage.clear()
  authMock.isSignedIn = true
  authMock.userRole = 'employee'
  render(<MemoryRouter><AireKiosk /></MemoryRouter>)
  expect(screen.getByText(/only admins can open this kiosk/i)).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Admin sign in to open kiosk' })).not.toBeInTheDocument()
})
