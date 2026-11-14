import { StrictMode } from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { myTimeApi } from '../../lib/api/myTime'
import MyTime from './MyTime'
import { ToastProvider } from '../../components/ui'
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

const viewer = vi.hoisted(() => ({ role: 'employee' }))
vi.mock('../../contexts/AuthContext', () => ({
  useAuthContext: () => ({
    currentUser: { id: 5, first_name: 'Ethan' },
    isClerkEnabled: true,
    userRole: viewer.role,
  }),
}))
vi.mock('../../lib/api/myTime', () => ({
  myTimeApi: {
    status: vi.fn(),
    categories: vi.fn(),
    ownCategories: vi.fn(),
    entries: vi.fn(),
    askForFix: vi.fn(),
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
  viewer.role = 'employee'
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
      <ToastProvider>
        <MyTime />
      </ToastProvider>
    </MemoryRouter>,
  )
  await screen.findByRole('button', { name: 'Clock in' })
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Clock in' })).toBeEnabled(),
  )
}

it('enables Clock in while the optional initial summary is still pending', async () => {
  let finish!: (value: Awaited<ReturnType<typeof myTimeApi.entries>>) => void
  vi.mocked(myTimeApi.entries).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  await open()
  expect(
    screen.getByRole('radio', { name: 'Flight Instruction' }),
  ).toBeChecked()
  expect(
    screen.getByText('Open My Hours to check your time.'),
  ).toBeInTheDocument()
  fireEvent.click(screen.getByRole('radio', { name: 'Ground School' }))
  await act(async () => {
    finish({ data: [shift({ time_category: categories[0] })] })
  })
  expect(screen.getByRole('radio', { name: 'Ground School' })).toBeChecked()
})

it('requires status recovery after a refused punch whose reconciliation read fails', async () => {
  await open()
  vi.mocked(myTimeApi.clockIn).mockResolvedValue({
    error: 'Already clocked in',
    status: 422,
  })
  vi.mocked(myTimeApi.status).mockResolvedValue({ error: 'Read failed' })
  fireEvent.click(screen.getByRole('button', { name: 'Clock in' }))
  expect(await screen.findByText('Status not confirmed')).toBeInTheDocument()
  expect(screen.getByRole('alert')).toHaveTextContent('Already clocked in')
  expect(screen.queryByText('Off the clock')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Clock in' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled()
})

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
      await screen.findByText(
        "We couldn't confirm your last tap. You're on the clock.",
      ),
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
      <ToastProvider>
        <MyTime />
      </ToastProvider>
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
      <ToastProvider>
        <MyTime />
      </ToastProvider>
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
      <ToastProvider>
        <MyTime />
      </ToastProvider>
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
        <ToastProvider>
        <MyTime />
      </ToastProvider>
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

it('says nothing extra after a normal clock-in: the card is the confirmation', async () => {
  await open()
  vi.mocked(myTimeApi.clockIn).mockResolvedValue({
    data: { time_entry: shift({ status: 'clocked_in' }) },
    status: 201,
  })
  vi.mocked(myTimeApi.status).mockResolvedValue({
    data: clockStatus({
      clocked_in: true,
      clock_in_at: '2026-11-14T12:00:00+10:00',
      time_category: categories[1],
    }),
    status: 200,
  })
  fireEvent.click(screen.getByRole('button', { name: 'Clock in' }))
  expect(
    await screen.findByText('On the clock · Ground School'),
  ).toBeInTheDocument()
  expect(screen.queryByText(/server/i)).not.toBeInTheDocument()
  expect(screen.queryByRole('status', { name: /confirm/ })).toBeNull()
})

it('after a lost reply, says plainly where the clock stands', async () => {
  await open()
  vi.mocked(myTimeApi.clockIn).mockResolvedValue({ error: 'Lost', status: 504 })
  vi.mocked(myTimeApi.status).mockResolvedValue({
    data: clockStatus({
      clocked_in: true,
      clock_in_at: '2026-11-14T20:25:00+10:00',
      time_category: categories[1],
    }),
    status: 200,
  })
  fireEvent.click(screen.getByRole('button', { name: 'Clock in' }))
  expect(
    await screen.findByText(
      "We couldn't confirm your last tap. You're on the clock since 8:25 PM.",
    ),
  ).toBeInTheDocument()
})

it('turns the out-of-range refusal into a next step', async () => {
  vi.mocked(myTimeApi.status).mockResolvedValue({
    data: clockStatus({ clock_in_location_name: 'AIRE Services Guam' }),
    status: 200,
  })
  vi.mocked(myTimeApi.clockIn).mockResolvedValue({
    error: 'Clock-in is only allowed while you are at AIRE Services Guam.',
    status: 422,
  })
  await open()
  fireEvent.click(screen.getByRole('button', { name: 'Clock in' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(
    "You need to be at AIRE Services Guam to clock in. If you're there, step outside for a better signal and try again.",
  )
})

it('names the location button for what it does', async () => {
  vi.mocked(myTimeApi.status).mockResolvedValue({
    data: clockStatus({ clock_in_location_required: true }),
    status: 200,
  })
  await open()
  fireEvent.click(screen.getByRole('button', { name: 'Clock in' }))
  const dialog = screen.getByRole('dialog', {
    name: 'Your location at clock-in',
  })
  expect(
    within(dialog).getByRole('button', { name: 'Share location and clock in' }),
  ).toBeInTheDocument()
})

it('marks the chosen work with a check', async () => {
  await open()
  const chosen = screen.getByRole('radio', { name: 'Ground School' })
  expect(chosen.parentElement!.querySelector('svg')).not.toBeNull()
  expect(
    screen
      .getByRole('radio', { name: 'Flight Instruction' })
      .parentElement!.querySelector('svg'),
  ).toBeNull()
})

it('shows a break in amber with when it started', async () => {
  vi.mocked(myTimeApi.status).mockResolvedValue({
    data: clockStatus({
      clocked_in: true,
      status: 'on_break',
      active_break: true,
      clock_in_at: '2026-11-14T08:00:00+10:00',
      active_break_started_at: '2026-11-14T11:30:00+10:00',
      time_category: categories[0],
    }),
    status: 200,
  })
  render(
    <MemoryRouter>
      <ToastProvider>
        <MyTime />
      </ToastProvider>
    </MemoryRouter>,
  )
  const heading = await screen.findByRole('heading', {
    name: 'On break · Flight Instruction',
  })
  expect(heading.closest('section')).toHaveClass('bg-amber-50')
  expect(screen.getByText('On break', { selector: 'p' })).toBeVisible()
  expect(
    screen.getByText('Break started 11:30 AM · on the clock since 8:00 AM'),
  ).toBeInTheDocument()
})

it('confirms a switch of work', async () => {
  const onTheClock = clockStatus({
    clocked_in: true,
    clock_in_at: '2026-11-14T10:00:00+10:00',
    time_category: categories[0],
  })
  vi.mocked(myTimeApi.status).mockResolvedValue({ data: onTheClock })
  render(
    <MemoryRouter>
      <ToastProvider>
        <MyTime />
      </ToastProvider>
    </MemoryRouter>,
  )
  fireEvent.click(await screen.findByRole('button', { name: 'Switch work' }))
  const sheet = screen.getByRole('dialog', { name: 'Switch work' })
  fireEvent.click(within(sheet).getByRole('radio', { name: 'Ground School' }))
  vi.mocked(myTimeApi.switchWork).mockResolvedValue({
    data: { time_entry: shift({ status: 'clocked_in' }) },
  })
  vi.mocked(myTimeApi.status).mockResolvedValue({
    data: { ...onTheClock, time_category: categories[1] },
  })
  fireEvent.click(within(sheet).getByRole('button', { name: 'Switch work' }))
  expect(await screen.findByText('Switched to Ground School.')).toBeVisible()
})

describe('clock-out confirms', () => {
  const clockedInAt = (iso: string) =>
    vi.mocked(myTimeApi.status).mockResolvedValue({
      data: clockStatus({
        clocked_in: true,
        clock_in_at: iso,
        time_category: categories[1],
      }),
    })
  const openClockedIn = async () => {
    render(
      <MemoryRouter>
        <ToastProvider>
          <MyTime />
        </ToastProvider>
      </MemoryRouter>,
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Clock out' }))
  }

  it('says less than a minute plainly and lets you keep working', async () => {
    clockedInAt('2026-11-14T11:59:40+10:00')
    await openClockedIn()
    const sheet = screen.getByRole('dialog', { name: /Clock out at/ })
    expect(sheet).toHaveTextContent("You've worked less than a minute.")
    expect(
      within(sheet).queryByRole('button', { name: 'I stopped earlier…' }),
    ).toBeNull()
    fireEvent.click(within(sheet).getByRole('button', { name: 'Keep working' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(myTimeApi.clockOut).not.toHaveBeenCalled()
  })

  it('sends the real stop time as a fix after a forgotten clock-out', async () => {
    clockedInAt('2026-11-13T19:00:00+10:00')
    await openClockedIn()
    const sheet = screen.getByRole('dialog', { name: /Clock out at/ })
    expect(sheet).toHaveTextContent('Worked 17h 0m.')
    fireEvent.click(
      within(sheet).getByRole('button', { name: 'I stopped earlier…' }),
    )
    const stopped = screen.getByRole('dialog', {
      name: 'When did you stop working?',
    })
    const time = within(stopped).getByLabelText(/I stopped working at/)
    fireEvent.change(time, { target: { value: '18:00' } })
    fireEvent.click(
      within(stopped).getByRole('button', { name: 'Clock out and send fix' }),
    )
    expect(
      await within(stopped).findByText(
        'Pick a time after you clocked in at 7:00 PM and before now.',
      ),
    ).toBeInTheDocument()
    expect(myTimeApi.clockOut).not.toHaveBeenCalled()

    const out = shift({
      work_date: '2026-11-13',
      start_time: '19:00',
      end_time: '12:00',
      clock_in_at: '2026-11-13T19:00:00+10:00',
      clock_out_at: '2026-11-14T12:00:00+10:00',
      hours: 17,
    })
    vi.mocked(myTimeApi.clockOut).mockResolvedValue({
      data: { time_entry: out },
    })
    vi.mocked(myTimeApi.askForFix).mockResolvedValue({
      data: { time_entry: { ...out, end_time: '23:30', hours: 4.5 } },
    })
    vi.mocked(myTimeApi.status).mockResolvedValue({ data: clockStatus() })
    fireEvent.change(time, { target: { value: '23:30' } })
    fireEvent.click(
      within(stopped).getByRole('button', { name: 'Clock out and send fix' }),
    )
    expect(
      await screen.findByText(
        'Clocked out. Your fix to 11:30 PM was sent for approval.',
      ),
    ).toBeVisible()
    expect(myTimeApi.clockOut).toHaveBeenCalledTimes(1)
    expect(myTimeApi.askForFix).toHaveBeenCalledWith(
      out,
      expect.objectContaining({ end_time: '23:30', start_time: '19:00' }),
      'Stopped working at 11:30 PM and forgot to clock out.',
    )
  })

  it('keeps the clock-out when the fix is refused, and says where to fix it', async () => {
    clockedInAt('2026-11-13T19:00:00+10:00')
    await openClockedIn()
    fireEvent.click(screen.getByRole('button', { name: 'I stopped earlier…' }))
    vi.mocked(myTimeApi.clockOut).mockResolvedValue({
      data: { time_entry: shift() },
    })
    vi.mocked(myTimeApi.askForFix).mockResolvedValue({
      error: 'Breaks must fall within the entry start and end time',
      status: 422,
    })
    vi.mocked(myTimeApi.status).mockResolvedValue({ data: clockStatus() })
    fireEvent.change(screen.getByLabelText(/I stopped working at/), {
      target: { value: '23:30' },
    })
    fireEvent.click(
      screen.getByRole('button', { name: 'Clock out and send fix' }),
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "You're clocked out, but your fix to 11:30 PM wasn't sent. Breaks must fall within the entry start and end time Open My Hours, tap the shift and choose Ask for a fix.",
    )
  })
})

describe('supervisors', () => {
  beforeEach(() => {
    viewer.role = 'manager'
    vi.mocked(myTimeApi.ownCategories).mockResolvedValue({
      data: { time_categories: [categories[1]] },
    })
  })

  it('offers only their own work and links their hours to Timecards', async () => {
    vi.mocked(myTimeApi.ownCategories).mockResolvedValue({
      data: { time_categories: categories },
    })
    await open()
    expect(myTimeApi.ownCategories).toHaveBeenCalledWith(5)
    expect(myTimeApi.categories).not.toHaveBeenCalled()
    expect(
      screen.getByRole('link', { name: /My hours in Timecards/ }),
    ).toHaveAttribute('href', '/admin/timecards?user_id=5')
    // A supervisor can read the team's time; this page only ever asks for theirs.
    expect(myTimeApi.entries).toHaveBeenCalled()
    for (const [userId] of vi.mocked(myTimeApi.entries).mock.calls)
      expect(userId).toBe(5)
  })

  it('can clock in early after a confirm that says why it was refused', async () => {
    vi.mocked(myTimeApi.status).mockResolvedValue({
      data: clockStatus({
        can_clock_in: false,
        clock_in_blocked_reason: 'too_early',
        minutes_until: 20,
        can_override_clock: true,
      }),
    })
    vi.mocked(myTimeApi.clockIn).mockResolvedValue({
      data: { time_entry: shift({ status: 'clocked_in' }) },
    })
    render(
      <MemoryRouter>
        <ToastProvider>
          <MyTime />
        </ToastProvider>
      </MemoryRouter>,
    )
    const anyway = await screen.findByRole('button', {
      name: 'Clock in anyway',
    })
    expect(screen.getByRole('button', { name: 'Clock in' })).toBeDisabled()
    expect(screen.getByText('Your shift starts in 20 minutes.')).toBeVisible()
    await waitFor(() => expect(anyway).toBeEnabled())
    fireEvent.click(anyway)
    const confirm = screen.getByRole('dialog', { name: 'Clock in anyway?' })
    expect(confirm).toHaveTextContent(
      "Your shift hasn't started yet. It starts in 20 minutes.",
    )
    expect(myTimeApi.clockIn).not.toHaveBeenCalled()
    fireEvent.click(
      within(confirm).getByRole('button', { name: 'Clock in anyway' }),
    )
    await waitFor(() =>
      expect(myTimeApi.clockIn).toHaveBeenCalledWith(2, undefined, true),
    )
  })

  it('can clock in after the scheduled shift ended', async () => {
    vi.mocked(myTimeApi.status).mockResolvedValue({
      data: clockStatus({
        can_clock_in: false,
        clock_in_blocked_reason: 'shift_ended',
        can_override_clock: true,
      }),
    })
    render(
      <MemoryRouter>
        <ToastProvider>
          <MyTime />
        </ToastProvider>
      </MemoryRouter>,
    )
    fireEvent.click(
      await screen.findByRole('button', { name: 'Clock in anyway' }),
    )
    expect(
      screen.getByRole('dialog', { name: 'Clock in anyway?' }),
    ).toHaveTextContent('Your scheduled shift has already ended.')
  })
})

it('never offers an employee the override', async () => {
  vi.mocked(myTimeApi.status).mockResolvedValue({
    data: clockStatus({
      can_clock_in: false,
      clock_in_blocked_reason: 'too_early',
      minutes_until: 20,
      can_override_clock: false,
    }),
  })
  render(
    <MemoryRouter>
      <ToastProvider>
        <MyTime />
      </ToastProvider>
    </MemoryRouter>,
  )
  expect(
    await screen.findByText('Your shift starts soon. Try again in 20 minutes.'),
  ).toBeVisible()
  expect(screen.queryByRole('button', { name: 'Clock in anyway' })).toBeNull()
})
