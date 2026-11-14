import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
import AireKiosk from './AireKiosk'

const authMock = vi.hoisted(() => ({ isClerkEnabled: true, isSignedIn: true, userRole: 'admin' as 'owner' | 'admin' | 'manager' | 'employee' | null }))
const mocks = vi.hoisted(() => ({ createAdminKioskSession: vi.fn(), getPayrollCutoff: vi.fn(), aireKioskVerify: vi.fn(), aireKioskClockIn: vi.fn(), aireKioskClockOut: vi.fn() }))
vi.mock('../../lib/api', () => ({ api: mocks }))
const stubMocks = vi.hoisted(() => ({ choices: vi.fn(), request: vi.fn() }))
vi.mock('../../lib/payStubsApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/payStubsApi')>()
  return { ...actual, kioskPayStubsApi: stubMocks }
})
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
  const clockIn = await screen.findByRole('button', { name: 'Clock In' })
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
  expect(screen.getByRole('button', { name: 'Manager or admin sign in' })).toBeInTheDocument()
})

it('shows an admin-only message for signed-in non-admin users', () => {
  sessionStorage.clear()
  authMock.isSignedIn = true
  authMock.userRole = 'employee'
  render(<MemoryRouter><AireKiosk /></MemoryRouter>)
  expect(screen.getByText(/only managers and admins can open this kiosk/i)).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Manager or admin sign in' })).not.toBeInTheDocument()
})

it('lets a signed-in manager unlock the kiosk', () => {
  sessionStorage.clear()
  authMock.isSignedIn = true
  authMock.userRole = 'manager'
  render(<MemoryRouter><AireKiosk /></MemoryRouter>)
  expect(screen.queryByText(/only managers and admins can open this kiosk/i)).not.toBeInTheDocument()
  expect(screen.getAllByRole('button', { name: /unlock/i }).length).toBeGreaterThan(0)
})

it('hides pay stub requests while they are off in Settings', async () => {
  mocks.getPayrollCutoff.mockResolvedValue({ data: null })
  render(<MemoryRouter><AireKiosk /></MemoryRouter>)
  for (const digit of '1234') fireEvent.click(screen.getByRole('button', { name: digit }))
  fireEvent.click(screen.getByRole('button', { name: 'Verify PIN' }))
  expect(await screen.findByRole('button', { name: 'Clock In' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Request my pay stub' })).not.toBeInTheDocument()
})

it('lets a verified employee request a pay stub and confirms it went to the office', async () => {
  mocks.aireKioskVerify.mockResolvedValue({ data: { employee, kiosk_token: 'employee-token', current_status: idle, available_categories: [category], pay_stub_requests_enabled: true } })
  mocks.getPayrollCutoff.mockResolvedValue({ data: null })
  stubMocks.choices.mockResolvedValue({ pay_dates: [], years: [2026], pay_dates_available: true, on_file_email_hint: 'a•••@example.com' })
  stubMocks.request.mockResolvedValue({ message: 'Your request was sent to the office.' })
  render(<MemoryRouter><AireKiosk /></MemoryRouter>)
  expect(screen.queryByRole('button', { name: 'Request my pay stub' })).not.toBeInTheDocument()
  for (const digit of '1234') fireEvent.click(screen.getByRole('button', { name: digit }))
  fireEvent.click(screen.getByRole('button', { name: 'Verify PIN' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Request my pay stub' }))
  expect(screen.queryByRole('button', { name: 'Clock In' })).not.toBeInTheDocument()
  fireEvent.click(await screen.findByRole('button', { name: 'Send request to the office' }))
  expect(await screen.findByText('Your request was sent to the office.')).toBeInTheDocument()
  expect(stubMocks.request).toHaveBeenCalledWith('access', 'employee-token', { scope: 'latest', statementId: undefined, year: undefined })
  expect(screen.getByRole('button', { name: 'Clock In' })).toBeInTheDocument()
})

it('says a manager or admin unlocks it, and offers the way out only while locked', () => {
  sessionStorage.clear()
  authMock.isSignedIn = true
  authMock.userRole = 'manager'
  render(<MemoryRouter><AireKiosk /></MemoryRouter>)
  expect(screen.getByText('A manager or admin unlocks this kiosk before staff can enter a PIN.')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Admin' })).toHaveAttribute('href', '/admin')
  expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/')
})

it('hides the Admin and Home links on the shared device while unlocked', () => {
  render(<MemoryRouter><AireKiosk /></MemoryRouter>)
  expect(screen.getByText('Kiosk unlocked')).toBeInTheDocument()
  expect(screen.queryByRole('link', { name: 'Admin' })).not.toBeInTheDocument()
  expect(screen.queryByRole('link', { name: 'Home' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Lock kiosk' })).toBeInTheDocument()
})

async function verifyEmployee() {
  for (const digit of '1234') fireEvent.click(screen.getByRole('button', { name: digit }))
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Verify PIN' })) })
}

it('puts PIN first on phones and gates actions behind verification', async () => {
  render(<MemoryRouter><AireKiosk /></MemoryRouter>)
  expect(screen.getByRole('region', { name: 'Staff PIN' })).toHaveClass('order-1')
  expect(screen.queryByRole('button', { name: 'Clock In' })).not.toBeInTheDocument()
  await verifyEmployee()
  expect(screen.getByRole('button', { name: 'Clock In' })).toBeEnabled()
  expect(screen.queryByRole('button', { name: 'Clock Out' })).not.toBeInTheDocument()
})

it('preserves lockout copy', async () => {
  mocks.aireKioskVerify.mockResolvedValue({ error: 'Too many failed PIN attempts. Try again in 15 minutes.', status: 429 })
  render(<MemoryRouter><AireKiosk /></MemoryRouter>)
  await verifyEmployee()
  expect(screen.getByText('Too many failed PIN attempts. Try again in 15 minutes.')).toBeInTheDocument()
})

it('clears the employee after 30 seconds idle', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-14T03:00:00Z'))
  try {
    render(<MemoryRouter><AireKiosk /></MemoryRouter>)
    await verifyEmployee()
    expect(screen.getByText('Avery Fixture')).toBeInTheDocument()
    await act(async () => { vi.advanceTimersByTime(30_000) })
    expect(screen.getByText('Waiting for PIN')).toBeInTheDocument()
  } finally { vi.useRealTimers() }
})

it('keeps state until server success and on refusal', async () => {
  let resolve!: (value: unknown) => void
  mocks.aireKioskClockIn.mockImplementation(() => new Promise(r => { resolve = r }))
  render(<MemoryRouter><AireKiosk /></MemoryRouter>)
  await verifyEmployee()
  fireEvent.click(screen.getByRole('button', { name: 'Clock In' }))
  expect(screen.getByText('Off the clock')).toBeInTheDocument()
  await act(async () => { resolve({ error: 'Not allowed', status: 422 }) })
  expect(screen.getByText('Off the clock')).toBeInTheDocument()
})

it.each([undefined, 500])('re-reads unknown outcome %s before another punch', async status => {
  let resolve!: (value: unknown) => void
  render(<MemoryRouter><AireKiosk /></MemoryRouter>)
  await verifyEmployee()
  mocks.aireKioskVerify.mockImplementation(() => new Promise(r => { resolve = r }))
  mocks.aireKioskClockIn.mockResolvedValue({ error: 'Response lost', status })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Clock In' })) })
  expect(screen.getByRole('button', { name: 'Clock In...' })).toBeDisabled()
  expect(mocks.aireKioskVerify).toHaveBeenLastCalledWith('1234', 'access')
  await act(async () => { resolve({ data: { employee, kiosk_token: 'refreshed', current_status: working, available_categories: [category] } }) })
  expect(screen.getByRole('button', { name: 'Clock Out' })).toBeEnabled()
})


it('renders the verified primary action before the supervisor controls', async () => {
  render(<MemoryRouter><AireKiosk /></MemoryRouter>)
  await verifyEmployee()
  const action = screen.getByRole('button', { name: 'Clock In' })
  const lock = screen.getByRole('button', { name: 'Lock kiosk' })
  expect(action.compareDocumentPosition(lock) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(action.parentElement).toHaveClass('fixed', 'bottom-0')
  expect(screen.getByRole('heading', { name: 'AIRE kiosk' })).toBeInTheDocument()
  expect(screen.getByText(/Guam ·/)).toBeInTheDocument()
})
