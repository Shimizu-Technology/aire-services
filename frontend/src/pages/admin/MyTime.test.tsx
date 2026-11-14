import { StrictMode } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { myTimeApi } from '../../lib/api/myTime'
import MyTime from './MyTime'
import * as clockHelpers from '../../lib/myTime'

const polling = vi.hoisted(() => ({
  tick: null as null | (() => Promise<void>),
}))
vi.mock('../../lib/visibilityPolling', () => ({
  startVisibilityAwarePolling: (tick: () => Promise<void>) => {
    polling.tick = tick
    return () => {}
  },
}))
import { categories, clockStatus, shift } from '../../test/employeeFixtures'

vi.mock('../../contexts/AuthContext', () => ({
  useAuthContext: () => ({ currentUser: { id: 5, first_name: 'Ethan' } }),
}))
vi.mock('../../lib/api/myTime', () => ({
  myTimeApi: {
    status: vi.fn(),
    categories: vi.fn(),
    entries: vi.fn(),
    clockIn: vi.fn(),
    clockOut: vi.fn(),
    startBreak: vi.fn(),
    endBreak: vi.fn(),
    switchWork: vi.fn(),
  },
}))
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-14T12:00:00+10:00'))
  vi.clearAllMocks()
  polling.tick = null
  localStorage.clear()
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
  vi.mocked(myTimeApi.status).mockResolvedValue({
    data: clockStatus(),
    status: 200,
  })
  vi.mocked(myTimeApi.categories).mockResolvedValue({
    data: { time_categories: categories },
    status: 200,
  })
  vi.mocked(myTimeApi.entries).mockResolvedValue({ data: [shift()] })
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})
const open = async () => {
  render(
    <MemoryRouter>
      <MyTime />
    </MemoryRouter>,
  )
  await screen.findByRole('button', { name: 'Clock in' })
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Clock in' })).toBeEnabled(),
  )
}

it('preselects the last work and flips state only after server success', async () => {
  let finish!: (value: Awaited<ReturnType<typeof myTimeApi.clockIn>>) => void
  vi.mocked(myTimeApi.clockIn).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  await open()
  expect(screen.getByRole('radio', { name: 'Ground School' })).toBeChecked()
  fireEvent.click(screen.getByRole('button', { name: 'Clock in' }))
  expect(screen.getByText('Off the clock')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Clock in' })).toBeDisabled()
  expect(myTimeApi.clockIn).toHaveBeenCalledWith(2, undefined)
  vi.mocked(myTimeApi.status).mockResolvedValue({
    data: clockStatus({
      clocked_in: true,
      clock_in_at: new Date().toISOString(),
      time_category: categories[1],
    }),
    status: 200,
  })
  await act(async () => finish({ data: { time_entry: shift() }, status: 201 }))
  expect(
    await screen.findByText('On the clock · Ground School'),
  ).toBeInTheDocument()
})

it('keeps the clock off on a refused punch', async () => {
  vi.mocked(myTimeApi.clockIn).mockResolvedValue({
    error: 'Outside the airport',
    status: 422,
  })
  await open()
  fireEvent.click(screen.getByRole('button', { name: 'Clock in' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Outside the airport',
  )
  expect(screen.getByText('Off the clock')).toBeInTheDocument()
  expect(myTimeApi.status).toHaveBeenCalledTimes(2)
})

it('disables punches offline and never sends one on reconnect', async () => {
  await open()
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
  act(() => window.dispatchEvent(new Event('offline')))
  expect(screen.getByRole('button', { name: 'Clock in' })).toBeDisabled()
  expect(
    screen.getByText(
      /Clock actions are paused; this is your last saved status/,
    ),
  ).toBeInTheDocument()
  expect(
    screen.queryByText(/Your clock-in wasn't sent/),
  ).not.toBeInTheDocument()
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
  act(() => window.dispatchEvent(new Event('online')))
  expect(myTimeApi.clockIn).not.toHaveBeenCalled()
})

it.each([undefined, 502])(
  're-reads status after an unknown outcome %s and blocks retry until known',
  async (status) => {
    vi.mocked(myTimeApi.clockIn).mockResolvedValue({
      error: 'Lost reply',
      status,
    })
    await open()
    vi.mocked(myTimeApi.status).mockResolvedValue({ error: 'Still offline' })
    fireEvent.click(screen.getByRole('button', { name: 'Clock in' }))
    await waitFor(() => expect(myTimeApi.status).toHaveBeenCalledTimes(2))
    expect(screen.getByRole('button', { name: 'Clock in' })).toBeDisabled()
    expect(screen.getByText('Status not confirmed')).toBeInTheDocument()
    expect(screen.queryByText('Off the clock')).not.toBeInTheDocument()
    expect(document.querySelector('time')).toBeNull()
    vi.mocked(myTimeApi.status).mockResolvedValue({
      data: clockStatus({ clocked_in: true }),
      status: 200,
    })
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(
      await screen.findByText('The server says: On the clock.'),
    ).toBeInTheDocument()
    expect(myTimeApi.clockIn).toHaveBeenCalledTimes(1)
  },
)

it('explains location before requesting it', async () => {
  vi.mocked(myTimeApi.status).mockResolvedValue({
    data: clockStatus({ clock_in_location_required: true }),
    status: 200,
  })
  await open()
  fireEvent.click(screen.getByRole('button', { name: 'Clock in' }))
  expect(
    screen.getByRole('dialog', { name: 'Your location at clock-in' }),
  ).toBeInTheDocument()
  expect(myTimeApi.clockIn).not.toHaveBeenCalled()
})

it('reconciles a 422 from a kiosk punch and retains the refusal message without locking actions', async () => {
  await open()
  vi.mocked(myTimeApi.clockIn).mockResolvedValue({
    error: 'You are already clocked in',
    status: 422,
  })
  vi.mocked(myTimeApi.status).mockResolvedValue({
    data: clockStatus({
      clocked_in: true,
      clock_in_at: new Date().toISOString(),
      time_category: categories[0],
    }),
  })
  fireEvent.click(screen.getByRole('button', { name: 'Clock in' }))
  expect(
    await screen.findByText('On the clock · Flight Instruction'),
  ).toBeInTheDocument()
  expect(screen.getByRole('alert')).toHaveTextContent(
    'You are already clocked in',
  )
  expect(screen.getByRole('button', { name: 'Clock out' })).toBeEnabled()
  vi.mocked(myTimeApi.status).mockResolvedValue({ data: clockStatus() })
  await act(async () => {
    await polling.tick?.()
  })
  expect(
    screen.getByRole('radio', { name: 'Flight Instruction' }),
  ).toBeChecked()
})

it('hides stale state after a successful punch whose status read fails', async () => {
  await open()
  vi.mocked(myTimeApi.clockIn).mockResolvedValue({
    data: { time_entry: shift() },
  })
  vi.mocked(myTimeApi.status).mockResolvedValue({ error: 'Read unavailable' })
  fireEvent.click(screen.getByRole('button', { name: 'Clock in' }))
  expect(await screen.findByText('Status not confirmed')).toBeInTheDocument()
  expect(screen.queryByText('Off the clock')).not.toBeInTheDocument()
  expect(document.querySelector('time')).toBeNull()
  expect(screen.getByRole('button', { name: 'Clock in' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled()
})

it('shows work-type load failure separately and retries', async () => {
  vi.mocked(myTimeApi.categories).mockResolvedValue({
    error: 'Failed',
    status: 500,
  })
  render(
    <MemoryRouter>
      <MyTime />
    </MemoryRouter>,
  )
  expect(
    await screen.findByText("Couldn't load your work types."),
  ).toBeInTheDocument()
  expect(screen.queryByText(/Ask Chels to set up/)).not.toBeInTheDocument()
  vi.mocked(myTimeApi.categories).mockResolvedValue({
    data: { time_categories: categories },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Clock in' })).toBeEnabled(),
  )
  expect(screen.getByRole('radio', { name: 'Ground School' })).toBeChecked()
})

it('clears an initial status-read error once polling succeeds', async () => {
  vi.mocked(myTimeApi.status).mockResolvedValue({ error: 'Unavailable' })
  render(
    <MemoryRouter>
      <MyTime />
    </MemoryRouter>,
  )
  expect(
    await screen.findByText("Couldn't check your clock. Try again."),
  ).toBeInTheDocument()
  vi.mocked(myTimeApi.status).mockResolvedValue({ data: clockStatus() })
  await act(async () => {
    await polling.tick?.()
  })
  expect(screen.getByText('Off the clock')).toBeInTheDocument()
  expect(
    screen.queryByText("Couldn't check your clock. Try again."),
  ).not.toBeInTheDocument()
})

it('does not clear remembered work when Switch work is cancelled', async () => {
  vi.mocked(myTimeApi.entries).mockResolvedValue({
    data: [shift({ time_category: categories[0] })],
  })
  vi.mocked(myTimeApi.status).mockResolvedValue({
    data: clockStatus({
      clocked_in: true,
      clock_in_at: new Date(Date.now() - 3 * 3_600_000).toISOString(),
      time_category: categories[0],
    }),
  })
  render(
    <MemoryRouter>
      <MyTime />
    </MemoryRouter>,
  )
  fireEvent.click(await screen.findByRole('button', { name: 'Switch work' }))
  fireEvent.click(screen.getByRole('radio', { name: 'Ground School' }))
  fireEvent.click(screen.getByRole('button', { name: 'Close' }))
  vi.mocked(myTimeApi.clockOut).mockResolvedValue({
    data: { time_entry: shift() },
  })
  vi.mocked(myTimeApi.status).mockResolvedValue({ data: clockStatus() })
  fireEvent.click(screen.getByRole('button', { name: 'Clock out' }))
  expect(
    await screen.findByRole('radio', { name: 'Flight Instruction' }),
  ).toBeChecked()
  expect(myTimeApi.switchWork).not.toHaveBeenCalled()
})

it('uses clock-in-specific offline copy only after an actual clock-in attempt fails before sending', async () => {
  localStorage.setItem('aire-location-explained', 'true')
  vi.mocked(myTimeApi.status).mockResolvedValue({
    data: clockStatus({ clock_in_location_required: true }),
  })
  let locate!: (
    value: Awaited<ReturnType<typeof clockHelpers.requestLocation>>,
  ) => void
  vi.spyOn(clockHelpers, 'requestLocation').mockImplementation(
    () =>
      new Promise((resolve) => {
        locate = resolve
      }),
  )
  await open()
  fireEvent.click(screen.getByRole('button', { name: 'Clock in' }))
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
  await act(async () => {
    locate({ latitude: 13, longitude: 144 })
  })
  expect(screen.getByRole('alert')).toHaveTextContent(
    "Your clock-in wasn't sent",
  )
  expect(myTimeApi.clockIn).not.toHaveBeenCalled()
})

it('excludes denied hours from the period and today after clock-out', async () => {
  const denied = shift({ id: 99, hours: 9, approval_status: 'denied' })
  vi.mocked(myTimeApi.entries).mockResolvedValue({ data: [shift(), denied] })
  await open()
  expect(screen.getByText('This pay period · 3.0h')).toBeInTheDocument()
  vi.mocked(myTimeApi.clockIn).mockResolvedValue({
    data: { time_entry: shift() },
  })
  vi.mocked(myTimeApi.status).mockResolvedValue({
    data: clockStatus({
      clocked_in: true,
      clock_in_at: new Date(Date.now() - 3 * 3_600_000).toISOString(),
      time_category: categories[0],
    }),
  })
  fireEvent.click(screen.getByRole('button', { name: 'Clock in' }))
  await screen.findByRole('button', { name: 'Clock out' })
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Clock out' })).toBeEnabled(),
  )
  vi.mocked(myTimeApi.clockOut).mockResolvedValue({
    data: { time_entry: shift() },
  })
  vi.mocked(myTimeApi.status).mockResolvedValue({ data: clockStatus() })
  fireEvent.click(screen.getByRole('button', { name: 'Clock out' }))
  expect(await screen.findByText(/3h 0m today/)).toBeInTheDocument()
})

it('does not keep clock actions busy while an optional summary refresh is frozen', async () => {
  await open()
  vi.mocked(myTimeApi.entries).mockImplementation(() => new Promise(() => {}))
  vi.mocked(myTimeApi.clockIn).mockResolvedValue({
    data: { time_entry: shift() },
  })
  vi.mocked(myTimeApi.status).mockResolvedValue({
    data: clockStatus({
      clocked_in: true,
      clock_in_at: new Date().toISOString(),
      time_category: categories[0],
    }),
  })
  fireEvent.click(screen.getByRole('button', { name: 'Clock in' }))
  await screen.findByText('On the clock · Flight Instruction')
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Clock out' })).toBeEnabled(),
  )
})

it('does not show an initial error from a superseded Strict Mode status read', async () => {
  render(
    <StrictMode>
      <MemoryRouter>
        <MyTime />
      </MemoryRouter>
    </StrictMode>,
  )
  await screen.findByText('Off the clock')
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Clock in' })).toBeEnabled(),
  )
  expect(
    screen.queryByText("Couldn't check your clock. Try again."),
  ).not.toBeInTheDocument()
})

it('ignores a pre-punch status read and refreshes summaries and listeners on confirmed recovery', async () => {
  await open()
  let finishOld!: (value: Awaited<ReturnType<typeof myTimeApi.status>>) => void
  vi.mocked(myTimeApi.status).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishOld = resolve
      }),
  )
  let oldRead!: Promise<void>
  act(() => {
    oldRead = polling.tick!()
  })
  vi.mocked(myTimeApi.clockIn).mockResolvedValue({
    error: 'Lost reply',
    status: 502,
  })
  vi.mocked(myTimeApi.status).mockResolvedValue({ error: 'Read unavailable' })
  fireEvent.click(screen.getByRole('button', { name: 'Clock in' }))
  await screen.findByText('Status not confirmed')
  await act(async () => {
    finishOld({ data: clockStatus() })
    await oldRead
  })
  expect(screen.getByText('Status not confirmed')).toBeInTheDocument()
  expect(screen.queryByText('Off the clock')).not.toBeInTheDocument()
  const listener = vi.fn()
  window.addEventListener('aire:clock-action', listener)
  vi.mocked(myTimeApi.entries).mockResolvedValue({
    data: [shift({ hours: 5 })],
  })
  vi.mocked(myTimeApi.status).mockResolvedValue({ data: clockStatus() })
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
  await screen.findByText('This pay period · 5.0h')
  expect(listener).toHaveBeenCalledTimes(1)
  expect(myTimeApi.clockIn).toHaveBeenCalledTimes(1)
  window.removeEventListener('aire:clock-action', listener)
})
