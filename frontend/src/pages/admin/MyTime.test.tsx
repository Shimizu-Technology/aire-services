import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { myTimeApi } from '../../lib/api/myTime'
import MyTime from './MyTime'
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
  vi.clearAllMocks()
  localStorage.clear()
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
  vi.mocked(myTimeApi.status).mockResolvedValue({ data: clockStatus(), status: 200 })
  vi.mocked(myTimeApi.categories).mockResolvedValue({
    data: { time_categories: categories },
    status: 200,
  })
  vi.mocked(myTimeApi.entries).mockResolvedValue({ data: [shift()] })
})
afterEach(() => vi.restoreAllMocks())
const open = async () => {
  render(
    <MemoryRouter>
      <MyTime />
    </MemoryRouter>
  )
  await screen.findByRole('button', { name: 'Clock in' })
}

it('preselects the last work and flips state only after server success', async () => {
  let finish!: (value: Awaited<ReturnType<typeof myTimeApi.clockIn>>) => void
  vi.mocked(myTimeApi.clockIn).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
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
  expect(await screen.findByText('On the clock · Ground School')).toBeInTheDocument()
})

it('keeps the clock off on a refused punch', async () => {
  vi.mocked(myTimeApi.clockIn).mockResolvedValue({
    error: 'Outside the airport',
    status: 422,
  })
  await open()
  fireEvent.click(screen.getByRole('button', { name: 'Clock in' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Outside the airport')
  expect(screen.getByText('Off the clock')).toBeInTheDocument()
  expect(myTimeApi.status).toHaveBeenCalledTimes(1)
})

it('disables punches offline and never sends one on reconnect', async () => {
  await open()
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
  act(() => window.dispatchEvent(new Event('offline')))
  expect(screen.getByRole('button', { name: 'Clock in' })).toBeDisabled()
  expect(screen.getByText(/Your clock-in wasn't sent/)).toBeInTheDocument()
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
  act(() => window.dispatchEvent(new Event('online')))
  expect(myTimeApi.clockIn).not.toHaveBeenCalled()
})

it.each([undefined, 502])(
  're-reads status after an unknown outcome %s and blocks retry until known',
  async (status) => {
    vi.mocked(myTimeApi.clockIn).mockResolvedValue({ error: 'Lost reply', status })
    await open()
    vi.mocked(myTimeApi.status).mockResolvedValue({ error: 'Still offline' })
    fireEvent.click(screen.getByRole('button', { name: 'Clock in' }))
    await waitFor(() => expect(myTimeApi.status).toHaveBeenCalledTimes(2))
    expect(screen.getByRole('button', { name: 'Clock in' })).toBeDisabled()
    vi.mocked(myTimeApi.status).mockResolvedValue({
      data: clockStatus({ clocked_in: true }),
      status: 200,
    })
    fireEvent.click(screen.getByRole('button', { name: 'Check clock status' }))
    expect(
      await screen.findByText('The server says: On the clock.')
    ).toBeInTheDocument()
    expect(myTimeApi.clockIn).toHaveBeenCalledTimes(1)
  }
)

it('explains location before requesting it', async () => {
  vi.mocked(myTimeApi.status).mockResolvedValue({
    data: clockStatus({ clock_in_location_required: true }),
    status: 200,
  })
  await open()
  fireEvent.click(screen.getByRole('button', { name: 'Clock in' }))
  expect(
    screen.getByRole('dialog', { name: 'Your location at clock-in' })
  ).toBeInTheDocument()
  expect(myTimeApi.clockIn).not.toHaveBeenCalled()
})
