import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Link, MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { api } from '../../lib/api'
import { myTimeApi } from '../../lib/api/myTime'
import { categories, shift } from '../../test/employeeFixtures'
import { HoursSummary } from '../../components/myhours/HoursSummary'
import MyHours from './MyHours'

vi.mock('../../contexts/AuthContext', () => ({
  useAuthContext: () => ({ currentUser: { id: 5 } }),
}))

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-14T12:00:00+10:00'))
  vi.restoreAllMocks()
  vi.spyOn(myTimeApi, 'entries').mockResolvedValue({ data: [shift()] })
  vi.spyOn(myTimeApi, 'categories').mockResolvedValue({
    data: { time_categories: categories },
    status: 200,
  })
  vi.spyOn(myTimeApi, 'people').mockResolvedValue({
    data: { users: [] },
    status: 200,
  })
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})
const open = () =>
  render(
    <MemoryRouter initialEntries={['/admin/my-hours?period=2026-11-01']}>
      <MyHours />
    </MemoryRouter>,
  )

it('shows one approval pill for unknown payroll, keeping overtime on the shift', async () => {
  vi.mocked(myTimeApi.entries).mockResolvedValue({
    data: [
      shift({
        overtime_status: 'pending',
        pending_overtime_hours: 6,
        payroll_status: {
          status: 'payment_history_unavailable',
          label: 'Payment status not tracked yet',
          paid_hours: 0,
          held_hours: 0,
        },
      }),
    ],
  })
  open()
  const row = await screen.findByRole('button', { name: /8:00 AM/ })
  expect(row.querySelectorAll('[data-tone]')).toHaveLength(1)
  expect(row).toHaveTextContent('Waiting for approval')
  expect(row).not.toHaveTextContent(/not tracked/i)
  expect(row).toHaveTextContent('6.0h overtime waiting')
})

it('shows paid status only when the payload confirms it', () => {
  const period = { start: '2026-11-01', end: '2026-11-15' }
  const view = render(
    <HoursSummary
      period={period}
      entries={[shift({ approval_status: 'approved' })]}
    />,
  )
  expect(screen.queryByText(/^Paid /)).not.toBeInTheDocument()
  view.rerender(
    <HoursSummary
      period={period}
      entries={[
        shift({
          payroll_status: {
            status: 'payment_issued',
            label: 'Paid',
            paid_hours: 3,
            held_hours: 0,
            paychecks: [{ statement_id: '1', pay_date: '2026-11-25' }],
          },
        }),
      ]}
    />,
  )
  expect(screen.getByText('Paid Wed, Nov 25')).toBeInTheDocument()
})

it('Ask for a fix sends the existing employee edit and its reason', async () => {
  const update = vi
    .spyOn(api, 'updateTimeEntry')
    .mockResolvedValue({ data: { time_entry: shift() }, status: 200 })
  open()
  fireEvent.click(await screen.findByRole('button', { name: /8:00 AM/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Ask for a fix' }))
  fireEvent.change(screen.getByLabelText(/Clock out/), {
    target: { value: '11:30' },
  })
  fireEvent.change(screen.getByLabelText(/What happened/), {
    target: { value: 'Phone died before I stopped.' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Send fix for approval' }))
  await waitFor(() =>
    expect(update).toHaveBeenCalledWith(
      41,
      { end_time: '11:30' },
      'Phone died before I stopped.',
    ),
  )
  expect(await screen.findByText(/Your time was saved/)).toBeInTheDocument()
})

it('can correct a one-minute shift without rewriting its original punch times', async () => {
  vi.mocked(myTimeApi.entries).mockResolvedValue({
    data: [
      shift({
        start_time: '12:25',
        end_time: '12:26',
        hours: 0.01,
        formatted_start_time: '12:25 PM',
        formatted_end_time: '12:26 PM',
      }),
    ],
  })
  const update = vi
    .spyOn(api, 'updateTimeEntry')
    .mockResolvedValue({ data: { time_entry: shift() }, status: 200 })
  open()
  fireEvent.click(await screen.findByRole('button', { name: /12:25 PM/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Ask for a fix' }))
  fireEvent.change(screen.getByLabelText(/What happened/), {
    target: { value: 'Wrong work type.' },
  })
  fireEvent.change(screen.getByLabelText(/^Work/), { target: { value: '1' } })
  fireEvent.click(screen.getByRole('button', { name: 'Send fix for approval' }))
  await waitFor(() => expect(update).toHaveBeenCalled())
  expect(update.mock.calls[0][1]).not.toHaveProperty('start_time')
  expect(update.mock.calls[0][1]).not.toHaveProperty('end_time')
  expect(update.mock.calls[0][1]).not.toHaveProperty('review_action')
  expect(update.mock.calls[0][1]).not.toHaveProperty('expected_version')
  expect(update.mock.calls[0][1]).not.toHaveProperty('description')
})

it('adds forgotten time for the viewer without accepting another user id', async () => {
  const create = vi.spyOn(api, 'createTimeEntry').mockResolvedValue({
    data: { time_entry: shift({ entry_method: 'manual' }) },
    status: 201,
  })
  open()
  fireEvent.click(
    await screen.findByRole('button', { name: 'Add time I forgot to clock' }),
  )
  expect(
    screen.queryByRole('combobox', { name: 'Who worked' }),
  ).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /Add 9.0h for approval/ }))
  await waitFor(() => expect(create).toHaveBeenCalled())
  expect(create.mock.calls[0][0]).not.toHaveProperty('user_id')
})

it('holds a forgotten-time form after an uncertain save', async () => {
  const create = vi
    .spyOn(api, 'createTimeEntry')
    .mockResolvedValue({ error: 'Lost reply', status: 502 })
  open()
  fireEvent.click(
    await screen.findByRole('button', { name: 'Add time I forgot to clock' }),
  )
  fireEvent.click(screen.getByRole('button', { name: /Add 9.0h for approval/ }))
  expect(await screen.findByRole('alert')).toHaveTextContent('check My Hours')
  expect(
    screen.getByRole('button', { name: /Add 9.0h for approval/ }),
  ).toBeDisabled()
  expect(create).toHaveBeenCalledTimes(1)
})

it('keeps stored break precision when only the work type changes', async () => {
  const entry = shift({
    break_minutes: 1,
    breaks: [
      {
        id: 8,
        start_time: '2026-11-14T09:00:59+10:00',
        end_time: '2026-11-14T09:02:01+10:00',
        duration_minutes: 1,
        active: false,
      },
    ],
  })
  vi.mocked(myTimeApi.entries).mockResolvedValue({ data: [entry] })
  const update = vi
    .spyOn(api, 'updateTimeEntry')
    .mockResolvedValue({ data: { time_entry: entry } })
  open()
  fireEvent.click(await screen.findByRole('button', { name: /8:00 AM/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Ask for a fix' }))
  fireEvent.change(screen.getByLabelText(/What happened/), {
    target: { value: 'Please check this shift.' },
  })
  fireEvent.change(screen.getByLabelText(/^Work/), { target: { value: '1' } })
  fireEvent.click(screen.getByRole('button', { name: 'Send fix for approval' }))
  await waitFor(() =>
    expect(update).toHaveBeenCalledWith(
      41,
      { time_category_id: 1 },
      'Please check this shift.',
    ),
  )
})

it('retries failed work types inside a forgotten-time sheet', async () => {
  vi.mocked(myTimeApi.categories).mockResolvedValueOnce({
    error: 'Unavailable',
  })
  open()
  fireEvent.click(
    await screen.findByRole('button', { name: 'Add time I forgot to clock' }),
  )
  expect(screen.getByText("Couldn't load your work types.")).toBeInTheDocument()
  expect(
    screen.queryByText('Ask Chels to set up your work types.'),
  ).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
  await screen.findByRole('option', { name: 'Ground School' })
  fireEvent.change(screen.getByLabelText(/Work/), { target: { value: '2' } })
  expect(
    screen.getByRole('button', { name: /Add 9.0h for approval/ }),
  ).toBeEnabled()
})

it('refreshes the current period when an older period’s save finishes after navigation', async () => {
  let finish!: (value: Awaited<ReturnType<typeof api.updateTimeEntry>>) => void
  vi.spyOn(api, 'updateTimeEntry').mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  render(
    <MemoryRouter initialEntries={['/admin/my-hours?period=2026-11-01']}>
      <Link to="/admin/my-hours?period=2026-10-16">Earlier period</Link>
      <MyHours />
    </MemoryRouter>,
  )
  fireEvent.click(await screen.findByRole('button', { name: /8:00 AM/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Ask for a fix' }))
  fireEvent.change(screen.getByLabelText(/What happened/), {
    target: { value: 'Please check this shift.' },
  })
  fireEvent.change(screen.getByLabelText(/^Work/), { target: { value: '1' } })
  fireEvent.click(screen.getByRole('button', { name: 'Send fix for approval' }))
  fireEvent.click(screen.getByRole('link', { name: 'Earlier period' }))
  await screen.findByText('No time recorded this pay period.')
  await act(async () => {
    finish({ data: { time_entry: shift() } })
  })
  await waitFor(() =>
    expect(myTimeApi.entries).toHaveBeenLastCalledWith(5, {
      start: '2026-10-11',
      end: '2026-10-31',
    }),
  )
  expect(
    screen.getByText('No time recorded this pay period.'),
  ).toBeInTheDocument()
})

it('asks for an actual correction before sending an empty employee edit', async () => {
  const update = vi.spyOn(api, 'updateTimeEntry')
  open()
  fireEvent.click(await screen.findByRole('button', { name: /8:00 AM/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Ask for a fix' }))
  fireEvent.change(screen.getByLabelText(/What happened/), {
    target: { value: 'Please check this shift.' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Send fix for approval' }))
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Change a time, break or work type',
  )
  expect(update).not.toHaveBeenCalled()
})
