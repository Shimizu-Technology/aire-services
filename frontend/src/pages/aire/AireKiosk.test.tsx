import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
import AireKiosk from './AireKiosk'

const authMock = vi.hoisted(() => ({ isClerkEnabled: true, isSignedIn: true, userRole: 'admin' as 'owner' | 'admin' | 'manager' | 'employee' | null }))
const mocks = vi.hoisted(() => ({ createAdminKioskSession: vi.fn(), getPayrollCutoff: vi.fn(), aireKioskVerify: vi.fn(), aireKioskClockIn: vi.fn(), aireKioskClockOut: vi.fn(), aireKioskStartBreak: vi.fn(), aireKioskSwitchCategory: vi.fn() }))
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
  localStorage.clear()
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
  const clockIn = await screen.findByRole('button', { name: 'Clock in' })
  await waitFor(() => expect(clockIn).toBeEnabled())
  expect(mocks.getPayrollCutoff).toHaveBeenCalledWith('access', 'employee-token')
  fireEvent.click(clockIn)
  await screen.findByText('Avery clocked in for Ground operations.')
  await act(async () => { pending[0]({ data: { cutoff: {}, acknowledged: false } }) })
  expect(screen.getByTestId('warning')).toHaveTextContent('none')
  await waitFor(() => expect(screen.getByRole('button', { name: 'Clock out' })).toBeEnabled(), { timeout: 2500 })
  fireEvent.click(screen.getByRole('button', { name: 'Clock out' }))
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
  expect(await screen.findByRole('button', { name: 'Clock in' })).toBeInTheDocument()
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
  expect(screen.queryByRole('button', { name: 'Clock in' })).not.toBeInTheDocument()
  fireEvent.click(await screen.findByRole('button', { name: 'Send request to the office' }))
  expect(await screen.findByText('Your request was sent to the office.')).toBeInTheDocument()
  expect(stubMocks.request).toHaveBeenCalledWith('access', 'employee-token', { scope: 'latest', statementId: undefined, year: undefined })
  expect(screen.getByRole('button', { name: 'Clock in' })).toBeInTheDocument()
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
  expect(screen.getByRole('button', { name: 'Supervisor' })).toBeInTheDocument()
  expect(screen.queryByRole('link', { name: 'Admin' })).not.toBeInTheDocument()
  expect(screen.queryByRole('link', { name: 'Home' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Supervisor' })).toBeInTheDocument()
})

async function verifyEmployee() {
  for (const digit of '1234') fireEvent.click(screen.getByRole('button', { name: digit }))
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Verify PIN' })) })
}

it('puts PIN first on phones and gates actions behind verification', async () => {
  render(<MemoryRouter><AireKiosk /></MemoryRouter>)
  expect(screen.getByRole('region', { name: 'Staff PIN' })).toHaveClass('order-1')
  expect(screen.queryByRole('button', { name: 'Clock in' })).not.toBeInTheDocument()
  await verifyEmployee()
  expect(screen.getByRole('button', { name: 'Clock in' })).toBeEnabled()
  expect(screen.queryByRole('button', { name: 'Clock out' })).not.toBeInTheDocument()
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
    expect(screen.getByRole('status')).toHaveTextContent('Still there, Avery?')
    for (let i = 0; i < 10; i++) await act(async () => { vi.advanceTimersByTime(1000) })
    expect(screen.getByText('Waiting for PIN')).toBeInTheDocument()
  } finally { vi.useRealTimers() }
})

it('keeps state until server success and on refusal', async () => {
  let resolve!: (value: unknown) => void
  mocks.aireKioskClockIn.mockImplementation(() => new Promise(r => { resolve = r }))
  render(<MemoryRouter><AireKiosk /></MemoryRouter>)
  await verifyEmployee()
  fireEvent.click(screen.getByRole('button', { name: 'Clock in' }))
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
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Clock in' })) })
  expect(screen.getByRole('button', { name: 'Clock in...' })).toBeDisabled()
  expect(mocks.aireKioskVerify).toHaveBeenLastCalledWith('1234', 'access')
  await act(async () => { resolve({ data: { employee, kiosk_token: 'refreshed', current_status: working, available_categories: [category] } }) })
  await waitFor(() => expect(screen.getByRole('button', { name: 'Clock out' })).toBeEnabled(), { timeout: 2500 })
})


it('renders the verified primary action before the supervisor controls', async () => {
  render(<MemoryRouter><AireKiosk /></MemoryRouter>)
  await verifyEmployee()
  const action = screen.getByRole('button', { name: 'Clock in' })
  const lock = screen.getByRole('button', { name: 'Supervisor' })
  expect(lock.compareDocumentPosition(action) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(action.parentElement).toHaveClass('fixed', 'bottom-0')
  expect(screen.getByRole('heading', { name: 'AIRE kiosk' })).toBeInTheDocument()
  expect(screen.getByText(/Guam ·/)).toBeInTheDocument()
})

it('keeps one-category clock-in enabled when an uncertain punch re-reads idle', async () => {
  render(<MemoryRouter><AireKiosk /></MemoryRouter>)
  await verifyEmployee()
  mocks.aireKioskClockIn.mockResolvedValue({ error: 'Server error', status: 500 })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Clock in' })) })
  expect(mocks.aireKioskVerify).toHaveBeenCalledTimes(2)
  expect(screen.getByRole('button', { name: 'Clock in' })).toBeEnabled()
})

it('keeps a still-available multi-category selection after a refusal and refreshes stale status', async () => {
  const second = { id: 2, name: 'Flight Instruction' }
  mocks.aireKioskVerify.mockResolvedValue({ data: { employee, kiosk_token: 'token', current_status: idle, available_categories: [category, second] } })
  render(<MemoryRouter><AireKiosk /></MemoryRouter>)
  await verifyEmployee()
  fireEvent.click(screen.getByRole('radio', { name: 'Flight Instruction' }))
  mocks.aireKioskClockIn.mockResolvedValue({ error: 'Already changed', status: 422 })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Clock in' })) })
  expect(mocks.aireKioskVerify).toHaveBeenCalledTimes(2)
  expect(screen.getByRole('radio', { name: 'Flight Instruction' })).toBeChecked()
})

it('pauses primary and break actions for 1.5 seconds after a successful punch', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-14T03:00:00Z'))
  try {
    render(<MemoryRouter><AireKiosk /></MemoryRouter>)
    await verifyEmployee()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Clock in' })) })
    expect(screen.getByRole('button', { name: 'Clock out' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Start break' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Clock out' }))
    expect(mocks.aireKioskClockOut).not.toHaveBeenCalled()
    await act(async () => { vi.advanceTimersByTime(1499) })
    expect(screen.getByRole('button', { name: 'Clock out' })).toBeDisabled()
    await act(async () => { vi.advanceTimersByTime(1) })
    expect(screen.getByRole('button', { name: 'Clock out' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Start break' })).toBeEnabled()
  } finally { vi.useRealTimers() }
})

it.each([0.5, 1, 12, 13])('uses employee Clock confirmation thresholds at %s hours', async hours => {
  vi.useFakeTimers()
  const now = new Date('2026-11-14T03:00:00Z')
  vi.setSystemTime(now)
  try {
    mocks.aireKioskVerify.mockResolvedValue({ data: { employee, kiosk_token: 'token', current_status: { ...working, break_minutes: 0, clock_in_at: new Date(+now - hours * 3600000).toISOString() }, available_categories: [category] } })
    render(<MemoryRouter><AireKiosk /></MemoryRouter>)
    await verifyEmployee()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Clock out' })) })
    if (hours < 1 || hours > 12) {
      expect(screen.getByRole('alertdialog', { name: 'Clock out at 1:00 PM?' })).toBeInTheDocument()
      expect(screen.getByText(/Check that this is when you stopped working/)).toBeInTheDocument()
      expect(mocks.aireKioskClockOut).not.toHaveBeenCalled()
      await act(async () => { fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Clock out' })) })
    }
    expect(mocks.aireKioskClockOut).toHaveBeenCalledOnce()
  } finally { vi.useRealTimers() }
})

it('clears the session if a reconciliation identifies another employee', async () => {
  render(<MemoryRouter><AireKiosk /></MemoryRouter>)
  await verifyEmployee()
  mocks.aireKioskClockIn.mockResolvedValue({ error: 'Lost', status: 500 })
  mocks.aireKioskVerify.mockResolvedValue({ data: { employee: { ...employee, id: 2 }, current_status: idle, available_categories: [category] } })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Clock in' })) })
  expect(screen.getByText('Waiting for PIN')).toBeInTheDocument()
  expect(screen.queryByText('Avery Fixture')).not.toBeInTheDocument()
})

it('removes the supervisor unlock when reconciliation says the kiosk is locked', async () => {
  render(<MemoryRouter><AireKiosk /></MemoryRouter>)
  await verifyEmployee()
  mocks.aireKioskClockIn.mockResolvedValue({ error: 'Lost', status: 500 })
  mocks.aireKioskVerify.mockResolvedValue({ error: 'Kiosk is locked. Ask an admin to unlock it before use.' })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Clock in' })) })
  expect(sessionStorage.getItem('aire_kiosk_access_session')).toBeNull()
  expect(screen.getByText('Kiosk locked')).toBeInTheDocument()
})

it('announces a saved punch discovered during reconciliation', async () => {
  const listener = vi.fn()
  window.addEventListener('aire:clock-action', listener)
  try {
    render(<MemoryRouter><AireKiosk /></MemoryRouter>)
    await verifyEmployee()
    mocks.aireKioskClockIn.mockResolvedValue({ error: 'Lost', status: 500 })
    mocks.aireKioskVerify.mockResolvedValue({ data: { employee, kiosk_token: 'token', current_status: working, available_categories: [category] } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Clock in' })) })
    expect(listener).toHaveBeenCalledOnce()
    expect(screen.getByText('On the clock')).toBeInTheDocument()
  } finally { window.removeEventListener('aire:clock-action', listener) }
})

it.each(['lock', 'expiry'])('ignores verification finishing after %s', async reason => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-14T03:00:00Z'))
  try {
    let resolve!: (value: unknown) => void
    mocks.aireKioskVerify.mockImplementation(() => new Promise(r => { resolve = r }))
    render(<MemoryRouter><AireKiosk /></MemoryRouter>)
    await verifyEmployee()
    if (reason === 'lock') {
      fireEvent.click(screen.getByRole('button', { name: 'Supervisor' }))
      fireEvent.click(screen.getByRole('button', { name: 'Lock kiosk' }))
    }
    else vi.setSystemTime(new Date('2100-01-01T00:00:00Z'))
    await act(async () => { resolve({ data: { employee, kiosk_token: 'token', current_status: idle, available_categories: [category] } }) })
    expect(screen.getByText('Waiting for PIN')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Clock in' })).not.toBeInTheDocument()
    expect(sessionStorage.getItem('aire_kiosk_access_session')).toBeNull()
  } finally { vi.useRealTimers() }
})

it('shows the work type when chips are hidden for a single category', async () => {
  render(<MemoryRouter><AireKiosk /></MemoryRouter>)
  await verifyEmployee()
  expect(screen.getByText('Working on: Ground operations')).toBeInTheDocument()
  expect(screen.queryByRole('radio')).not.toBeInTheDocument()
})

it('corrects stale clock state after a refused punch', async () => {
  render(<MemoryRouter><AireKiosk /></MemoryRouter>)
  await verifyEmployee()
  mocks.aireKioskClockIn.mockResolvedValue({ error: 'Already clocked in', status: 422 })
  mocks.aireKioskVerify.mockResolvedValue({ data: { employee, kiosk_token: 'refreshed', current_status: working, available_categories: [category] } })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Clock in' })) })
  expect(screen.getByText('On the clock')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Clock out' })).toBeInTheDocument()
})

it('empty-space taps in a confirmation do not extend the warning', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-14T03:00:00Z'))
  try {
    mocks.aireKioskVerify.mockResolvedValue({ data: { employee, kiosk_token: 'token', current_status: { ...working, clock_in_at: '2026-11-14T02:30:00Z' }, available_categories: [category] } })
    render(<MemoryRouter><AireKiosk /></MemoryRouter>)
    await verifyEmployee()
    fireEvent.click(screen.getByRole('button', { name: 'Clock out' }))
    await act(async () => { vi.advanceTimersByTime(30000) })
    const warning = screen.getByRole('status')
    expect(warning).toHaveTextContent("Still there, Avery? Tap I'm still here to keep going")
    expect(warning.parentElement).toHaveClass('z-[calc(var(--z-dialog)+1)]')
    expect(warning.querySelector('[aria-hidden=true]')).toHaveTextContent('(10)')
    fireEvent.pointerDown(screen.getByRole('main'))
    fireEvent.click(screen.getByRole('alertdialog'))
    fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Tab' })
    await act(async () => { vi.advanceTimersByTime(10000) })
    expect(screen.getByText('Waiting for PIN')).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  } finally { vi.useRealTimers() }
})

it('shows Guam time when the device uses America/Los_Angeles', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-14T03:00:00Z'))
  vi.stubEnv('TZ', 'America/Los_Angeles')
  // Node worker threads cannot reliably change their native default zone at
  // runtime. Model the device locale call too; an implicit-zone header fails.
  const localeTime = Date.prototype.toLocaleTimeString
  const spy = vi.spyOn(Date.prototype, 'toLocaleTimeString').mockImplementation(function(this: Date, locales, options) {
    return localeTime.call(this, locales, { ...options, timeZone: options?.timeZone ?? 'America/Los_Angeles' })
  })
  try {
    render(<MemoryRouter><AireKiosk /></MemoryRouter>)
    await verifyEmployee()
    expect(screen.getByText('Guam · 1:00 PM')).toBeInTheDocument()
    expect(screen.queryByText('Guam · 7:00 PM')).not.toBeInTheDocument()
  } finally { spy.mockRestore(); vi.unstubAllEnvs(); vi.useRealTimers() }
})

it.each(['Invalid PIN', 'Kiosk access is temporarily locked. Please contact a manager.'])('places %s beside the PIN controls', async message => {
  mocks.aireKioskVerify.mockResolvedValue({ error: message, status: 422 })
  render(<MemoryRouter><AireKiosk /></MemoryRouter>)
  await verifyEmployee()
  const pinSection = screen.getByRole('region', { name: 'Staff PIN' })
  expect(pinSection).toContainElement(screen.getByRole('alert'))
  expect(screen.getByRole('alert')).toHaveTextContent(message === 'Invalid PIN' ? "That PIN didn't match. Try again." : message)
  expect(screen.getByRole('button', { name: 'Verify PIN' }).compareDocumentPosition(screen.getByRole('alert')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
})

it('keeps punch errors beside the employee actions', async () => {
  render(<MemoryRouter><AireKiosk /></MemoryRouter>)
  await verifyEmployee()
  mocks.aireKioskClockIn.mockResolvedValue({ error: 'Punch refused', status: 422 })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Clock in' })) })
  expect(screen.getByRole('alert')).toHaveTextContent('Punch refused')
  expect(screen.getByRole('button', { name: 'Clock in' }).closest('section')).toContainElement(screen.getByRole('alert'))
})


it('uses saved work only while still assigned and explains a missing choice', async () => {
  localStorage.setItem('aire-last-work-1', '2')
  const second = { id: 2, name: 'Flight Instruction' }
  mocks.aireKioskVerify.mockResolvedValue({ data: { employee, kiosk_token: 'token', current_status: idle, available_categories: [category, second] } })
  render(<MemoryRouter><AireKiosk /></MemoryRouter>)
  await verifyEmployee()
  expect(screen.getByRole('radio', { name: second.name })).toBeChecked()
  fireEvent.click(screen.getByRole('button', { name: 'Not you? Reset' }))
  localStorage.setItem('aire-last-work-1', '99')
  await verifyEmployee()
  expect(screen.getByRole('button', { name: 'Clock in' })).toBeDisabled()
  expect(screen.getByText("Pick what you're working on")).toBeInTheDocument()
})

it('clears a wrong PIN and provides keypad names and a main landmark', async () => {
  mocks.aireKioskVerify.mockResolvedValue({ error: 'Invalid PIN' })
  render(<MemoryRouter><AireKiosk /></MemoryRouter>)
  expect(screen.getByRole('main')).toBeInTheDocument()
  expect(screen.queryByText('Off the clock')).not.toBeInTheDocument()
  expect(screen.getByText('——————')).toHaveClass('whitespace-nowrap')
  expect(screen.getByRole('button', { name: 'Delete last digit' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Clear' })).toBeInTheDocument()
  await verifyEmployee()
  expect(screen.getByText("That PIN didn't match. Try again.")).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Verify PIN' })).toBeDisabled()
})

it('requires confirmation to lock and provides a 44px supervisor target', () => {
  render(<MemoryRouter><AireKiosk /></MemoryRouter>)
  expect(screen.queryByRole('button', { name: 'Lock kiosk' })).not.toBeInTheDocument()
  const supervisor = screen.getByRole('button', { name: 'Supervisor' })
  expect(supervisor).toHaveClass('min-h-11')
  fireEvent.click(supervisor)
  expect(screen.getByText("Staff can't clock in until a manager unlocks it.")).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(sessionStorage.getItem('aire_kiosk_access_session')).not.toBeNull()
  fireEvent.click(supervisor)
  fireEvent.click(screen.getByRole('button', { name: 'Lock kiosk' }))
  expect(sessionStorage.getItem('aire_kiosk_access_session')).toBeNull()
})

it('warns during a pay stub draft and keeps it when typing resumes', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-14T03:00:00Z'))
  try {
    mocks.aireKioskVerify.mockResolvedValue({ data: { employee, kiosk_token: 'token', current_status: idle, available_categories: [category], pay_stub_requests_enabled: true } })
    stubMocks.choices.mockResolvedValue({ pay_dates: [], years: [2026], pay_dates_available: true })
    render(<MemoryRouter><AireKiosk /></MemoryRouter>)
    await verifyEmployee()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Request my pay stub' })) })
    await act(async () => { vi.advanceTimersByTime(30000) })
    expect(screen.getByRole('status')).toHaveTextContent('Still there, Avery?')
    fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: 'avery@example.com' } })
    await act(async () => { vi.advanceTimersByTime(10000) })
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send request to the office' })).toBeInTheDocument()
  } finally { vi.useRealTimers() }
})

it('selecting different work waits for Switch work and confirmation', async () => {
  const second = { id: 2, name: 'Flight Instruction' }
  mocks.aireKioskVerify.mockResolvedValue({ data: { employee, kiosk_token: 'token', current_status: working, available_categories: [category, second] } })
  mocks.aireKioskSwitchCategory.mockResolvedValue({ data: { employee, current_status: { ...working, time_category: second }, available_categories: [category, second], time_entry: { time_category: second } } })
  render(<MemoryRouter><AireKiosk /></MemoryRouter>)
  await verifyEmployee()
  fireEvent.click(screen.getByRole('radio', { name: second.name }))
  expect(mocks.aireKioskSwitchCategory).not.toHaveBeenCalled()
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Switch work' }))
  expect(screen.getByRole('alertdialog', { name: 'Switch work to Flight Instruction?' })).toBeInTheDocument()
  expect(mocks.aireKioskSwitchCategory).not.toHaveBeenCalled()
  await act(async () => { fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Switch work' })) })
  expect(mocks.aireKioskSwitchCategory).toHaveBeenCalledWith('access', 'token', 2)
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
})


it('does not warn on an empty lobby, after clearing digits, or after reset', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-14T03:00:00Z'))
  try {
    render(<MemoryRouter><AireKiosk /></MemoryRouter>)
    await act(async () => { vi.advanceTimersByTime(300000) })
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '1' }))
    await act(async () => { vi.advanceTimersByTime(30000) })
    expect(screen.getByRole('status')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    await act(async () => { vi.advanceTimersByTime(60000) })
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    await verifyEmployee()
    fireEvent.click(screen.getByRole('button', { name: 'Not you? Reset' }))
    await act(async () => { vi.advanceTimersByTime(60000) })
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  } finally { vi.useRealTimers() }
})

it('explicitly renews idle time but never extends the five-minute PIN deadline', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-14T03:00:00Z'))
  try {
    render(<MemoryRouter><AireKiosk /></MemoryRouter>)
    await verifyEmployee()
    for (let i = 0; i < 9; i++) {
      await act(async () => { vi.advanceTimersByTime(30000) })
      expect(screen.getByRole('status')).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: "I'm still here" }))
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
    }
    // At 4:50 the hard-cap warning appears even though idle time was renewed at 4:30.
    await act(async () => { vi.advanceTimersByTime(20000) })
    expect(screen.getByRole('status')).toHaveTextContent('(10)')
    fireEvent.click(screen.getByRole('button', { name: "I'm still here" }))
    expect(screen.getByRole('status')).toBeInTheDocument()
    await act(async () => { vi.advanceTimersByTime(10000) })
    expect(screen.getByText('Waiting for PIN')).toBeInTheDocument()
    expect(screen.queryByText('Avery Fixture')).not.toBeInTheDocument()
  } finally { vi.useRealTimers() }
})

it.each([[[]], [[category]]])('does not suggest picking work when clock-in is unavailable (%j)', async assigned => {
  mocks.aireKioskVerify.mockResolvedValue({ data: { employee, kiosk_token: 'token', current_status: { ...idle, can_clock_in: false }, available_categories: assigned } })
  render(<MemoryRouter><AireKiosk /></MemoryRouter>)
  await verifyEmployee()
  expect(screen.queryByText("Pick what you're working on")).not.toBeInTheDocument()
})

it('disables Switch work confirmation and controls while switching, then cools actions', async () => {
  const second = { id: 2, name: 'Flight Instruction' }
  mocks.aireKioskVerify.mockResolvedValue({ data: { employee, kiosk_token: 'token', current_status: working, available_categories: [category, second] } })
  let resolve!: (result: unknown) => void
  mocks.aireKioskSwitchCategory.mockImplementation(() => new Promise(r => { resolve = r }))
  render(<MemoryRouter><AireKiosk /></MemoryRouter>)
  await verifyEmployee()
  fireEvent.click(screen.getByRole('radio', { name: second.name }))
  fireEvent.click(screen.getByRole('button', { name: 'Switch work' }))
  fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Switch work' }))
  expect(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Switch work' })).toBeDisabled()
  await act(async () => { resolve({ data: { employee, current_status: { ...working, time_category: second }, available_categories: [category, second], time_entry: { time_category: second } } }) })
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Clock out' })).toBeDisabled()
})
