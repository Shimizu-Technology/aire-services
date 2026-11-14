import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ClockStatus } from '../../lib/api'
import { categories, clockStatus, shift } from '../../test/employeeFixtures'
import MyTime from '../../pages/admin/MyTime'
import AdminLayout from './AdminLayout'

const clock = vi.hoisted(() => ({
  status: vi.fn(),
  categories: vi.fn(),
  entries: vi.fn(),
  clockIn: vi.fn(),
  clockOut: vi.fn(),
}))

vi.mock('../../lib/api/myTime', () => ({ myTimeApi: clock }))
vi.mock('../../lib/api', () => ({ api: {} }))
vi.mock('../../contexts/AuthContext', () => ({
  useAuthContext: () => ({
    isClerkEnabled: true,
    userRole: 'employee',
    currentUser: {
      id: 5,
      first_name: 'Ethan',
      full_name: 'Ethan Cruz',
      role: 'employee',
      time_tracking_enabled: true,
      my_pay_enabled: true,
      schedules_enabled: false,
      needs_kiosk_pin_setup: false,
    },
    refreshCurrentUser: vi.fn(),
  }),
}))
vi.mock('@clerk/clerk-react', () => ({
  SignedIn: ({ children }: { children: ReactNode }) => <>{children}</>,
  UserButton: () => null,
  useClerk: () => ({ openUserProfile: vi.fn(), signOut: vi.fn() }),
}))

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-14T12:00:00+10:00'))
})
afterEach(() => vi.useRealTimers())

it('keeps the employee header and tabs mounted while Clock loads, punches and reconciles', async () => {
  let finishInitial!: (value: { data: ClockStatus }) => void
  let finishPunch!: (value: {
    data: { time_entry: ReturnType<typeof shift> }
  }) => void
  clock.status.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishInitial = resolve
      }),
  )
  clock.categories.mockResolvedValue({ data: { time_categories: categories } })
  clock.entries.mockResolvedValue({ data: [shift()] })
  clock.clockIn.mockImplementation(
    () =>
      new Promise((resolve) => {
        finishPunch = resolve
      }),
  )

  render(
    <MemoryRouter initialEntries={['/admin/my-time']}>
      <Routes>
        <Route element={<AdminLayout />}>
          <Route path="/admin/my-time" element={<MyTime />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
  const tabs = screen.getByRole('navigation', { name: 'Main tabs' })
  const brand = screen.getByRole('link', { name: 'AIRE Ops' })
  const assertChrome = () => {
    expect(screen.getByRole('navigation', { name: 'Main tabs' })).toBe(tabs)
    expect(tabs).toBeVisible()
    expect(tabs).not.toHaveAttribute('hidden')
    expect(within(tabs).getByRole('link', { name: 'Clock' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(within(tabs).getAllByRole('link')).toHaveLength(4)
    expect(screen.getByRole('link', { name: 'AIRE Ops' })).toBe(brand)
    expect(brand).toBeVisible()
    expect(screen.getByRole('button', { name: 'Account menu' })).toBeVisible()
  }
  expect(screen.getByText('Checking your clock…')).toBeInTheDocument()
  assertChrome()

  await act(async () => {
    finishInitial({ data: clockStatus() })
  })
  expect(await screen.findByText('Off the clock')).toBeInTheDocument()
  assertChrome()

  const active = clockStatus({
    clocked_in: true,
    clock_in_at: new Date(Date.now() - 3 * 3_600_000).toISOString(),
    time_category: categories[0],
  })
  clock.status.mockResolvedValue({ data: active })
  fireEvent.click(screen.getByRole('button', { name: 'Clock in' }))
  expect(screen.getByRole('button', { name: 'Clock in' })).toBeDisabled()
  assertChrome()
  await act(async () => {
    finishPunch({ data: { time_entry: shift() } })
  })
  expect(
    await screen.findByText('On the clock · Flight Instruction'),
  ).toBeInTheDocument()
  assertChrome()

  clock.clockOut.mockResolvedValue({ error: 'Lost reply', status: 502 })
  clock.status.mockResolvedValue({ error: 'Status unavailable' })
  fireEvent.click(screen.getByRole('button', { name: 'Clock out' }))
  expect(await screen.findByText('Status not confirmed')).toBeInTheDocument()
  assertChrome()
})
