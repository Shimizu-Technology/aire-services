import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { Link, MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { api } from '../../lib/api'
import { myTimeApi } from '../../lib/api/myTime'
import { categories, shift } from '../../test/employeeFixtures'
import { HoursSummary } from '../../components/myhours/HoursSummary'
import MyHours from './MyHours'
import { ToastProvider } from '../../components/ui'

vi.mock('../../contexts/AuthContext', () => ({
  useAuthContext: () => ({ currentUser: { id: 5 } }),
}))

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-14T12:00:00+10:00'))
  vi.restoreAllMocks()
  vi.spyOn(myTimeApi, 'entries').mockResolvedValue({ data: [shift()] })
  vi.spyOn(myTimeApi, 'entry').mockResolvedValue({
    data: { time_entry: shift() },
  })
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
      <ToastProvider>
        <MyHours />
      </ToastProvider>
    </MemoryRouter>,
  )
// Added time starts blank: the day first, then the times.
const fillAddedTime = (date = '2026-11-13') => {
  fireEvent.change(screen.getByLabelText(/Which day\?/), {
    target: { value: date },
  })
  fireEvent.change(screen.getByLabelText(/^Clock in/), {
    target: { value: '08:00' },
  })
  fireEvent.change(screen.getByLabelText(/^Clock out/), {
    target: { value: '17:00' },
  })
}

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
  expect(await screen.findByText('Your fix was sent for approval.')).toBeInTheDocument()
  expect(myTimeApi.entry).toHaveBeenCalledWith(41)
  expect(vi.mocked(myTimeApi.entry).mock.invocationCallOrder[0]).toBeLessThan(
    update.mock.invocationCallOrder[0],
  )
})

it('reloads a stale correction sheet without writing, then saves against the fresh version', async () => {
  const fresh = shift({
    version: 3,
    end_time: '12:00',
    hours: 4,
    description: 'Manager corrected note',
  })
  vi.mocked(myTimeApi.entry).mockResolvedValue({ data: { time_entry: fresh } })
  const update = vi
    .spyOn(api, 'updateTimeEntry')
    .mockResolvedValue({ data: { time_entry: fresh } })
  open()
  fireEvent.click(await screen.findByRole('button', { name: /8:00 AM/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Ask for a fix' }))
  fireEvent.change(screen.getByLabelText(/Clock out/), {
    target: { value: '11:30' },
  })
  fireEvent.change(screen.getByLabelText(/What happened/), {
    target: { value: 'Old correction.' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Send fix for approval' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(
    "This shift changed since you opened it. Nothing was sent. Here's the latest.",
  )
  expect(update).not.toHaveBeenCalled()
  expect(screen.getByLabelText(/Clock out/)).toHaveValue('12:00')
  expect(screen.getByLabelText(/What happened/)).toHaveValue('')
  fireEvent.change(screen.getByLabelText(/Clock out/), {
    target: { value: '12:30' },
  })
  fireEvent.change(screen.getByLabelText(/What happened/), {
    target: { value: 'Fresh correction.' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Send fix for approval' }))
  await waitFor(() =>
    expect(update).toHaveBeenCalledWith(
      41,
      { end_time: '12:30' },
      'Fresh correction.',
    ),
  )
  expect(myTimeApi.entry).toHaveBeenCalledTimes(2)
})

it('sends no correction when the fresh-version check fails', async () => {
  vi.mocked(myTimeApi.entry).mockResolvedValue({ error: 'Unavailable' })
  const update = vi.spyOn(api, 'updateTimeEntry')
  open()
  fireEvent.click(await screen.findByRole('button', { name: /8:00 AM/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Ask for a fix' }))
  fireEvent.change(screen.getByLabelText(/Clock out/), {
    target: { value: '11:30' },
  })
  fireEvent.change(screen.getByLabelText(/What happened/), {
    target: { value: 'Phone died.' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Send fix for approval' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(
    "Couldn't check this shift. Nothing was sent.",
  )
  expect(update).not.toHaveBeenCalled()
  expect(screen.getByLabelText(/Clock out/)).toHaveValue('11:30')
  expect(
    screen.getByRole('button', { name: 'Send fix for approval' }),
  ).toBeEnabled()
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
  fillAddedTime()
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
  fillAddedTime()
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
  fillAddedTime()
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
      <ToastProvider>
        <MyHours />
      </ToastProvider>
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

it('asks which day first and never prefills added time', async () => {
  const create = vi.spyOn(api, 'createTimeEntry')
  open()
  fireEvent.click(
    await screen.findByRole('button', { name: 'Add time I forgot to clock' }),
  )
  const sheet = screen.getByRole('dialog', {
    name: 'Add time I forgot to clock',
  })
  expect(within(sheet).getByLabelText(/Which day\?/)).toHaveValue('')
  expect(within(sheet).queryByLabelText(/^Clock in/)).toBeNull()
  fireEvent.change(within(sheet).getByLabelText(/Which day\?/), {
    target: { value: '2026-11-13' },
  })
  expect(within(sheet).getByLabelText(/^Clock in/)).toHaveValue('')
  expect(within(sheet).getByLabelText(/^Clock out/)).toHaveValue('')
  fireEvent.click(
    within(sheet).getByRole('button', { name: 'Add time for approval' }),
  )
  expect(within(sheet).getByRole('alert')).toHaveTextContent(
    'Pick the day, then the times you worked.',
  )
  expect(create).not.toHaveBeenCalled()
})

it('shows the overlap refusal in the form, keeping what was typed', async () => {
  const overlap =
    'This overlaps your 7:00 AM–1:20 PM shift on Sat, Nov 14. Change the times or pick another day.'
  vi.spyOn(api, 'createTimeEntry').mockResolvedValue({
    error: overlap,
    status: 422,
  })
  open()
  fireEvent.click(
    await screen.findByRole('button', { name: 'Add time I forgot to clock' }),
  )
  fillAddedTime('2026-11-14')
  fireEvent.click(screen.getByRole('button', { name: /Add 9.0h for approval/ }))
  const sheet = screen.getByRole('dialog', {
    name: 'Add time I forgot to clock',
  })
  expect(await within(sheet).findByRole('alert')).toHaveTextContent(overlap)
  expect(within(sheet).getByLabelText(/^Clock in/)).toHaveValue('08:00')
  expect(
    within(sheet).getByRole('button', { name: /Add 9.0h for approval/ }),
  ).toBeEnabled()
})

it('puts Add time right under the summary and confirms a save with a toast', async () => {
  vi.spyOn(api, 'createTimeEntry').mockResolvedValue({
    data: { time_entry: shift({ entry_method: 'manual' }) },
    status: 201,
  })
  open()
  const add = await screen.findByRole('button', {
    name: 'Add time I forgot to clock',
  })
  const summary = screen.getByRole('region', { name: 'Pay period summary' })
  const firstShift = screen.getByRole('button', { name: /8:00 AM/ })
  expect(summary.nextElementSibling).toBe(add)
  expect(
    add.compareDocumentPosition(firstShift) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy()
  fireEvent.click(add)
  fillAddedTime()
  fireEvent.click(screen.getByRole('button', { name: /Add 9.0h for approval/ }))
  expect(
    await screen.findByText('Your time was added and sent for approval.'),
  ).toBeVisible()
})

it('labels a shift with a pending fix request', async () => {
  vi.mocked(myTimeApi.entries).mockResolvedValue({
    data: [
      shift({
        approval_reasons: [{ key: 'employee_edited', label: 'Employee edited' }],
      }),
    ],
  })
  open()
  expect(
    await screen.findByRole('button', { name: /8:00 AM/ }),
  ).toHaveTextContent('Fix requested — waiting for approval')
})

it('lets you remove time you added while it is still waiting', async () => {
  const added = shift({
    id: 77,
    entry_method: 'manual',
    clock_source: null,
    clock_in_at: null,
    clock_out_at: null,
  })
  vi.mocked(myTimeApi.entries).mockResolvedValue({ data: [added] })
  const removeShift = vi
    .spyOn(myTimeApi, 'removeShift')
    .mockResolvedValue({ data: null })
  open()
  fireEvent.click(await screen.findByRole('button', { name: /8:00 AM/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Remove this shift' }))
  const confirm = screen.getByRole('alertdialog', { name: 'Remove this shift?' })
  expect(confirm).toHaveTextContent(
    "Your 8:00 AM–11:00 AM shift on Sat, Nov 14 will be deleted. It hasn't been approved, so nothing else changes.",
  )
  vi.mocked(myTimeApi.entries).mockResolvedValue({ data: [] })
  fireEvent.click(within(confirm).getByRole('button', { name: 'Remove shift' }))
  expect(
    await screen.findByText('Removed your Sat, Nov 14 shift.'),
  ).toBeVisible()
  expect(removeShift).toHaveBeenCalledWith(77)
  expect(await screen.findByText('No time recorded this pay period.')).toBeVisible()
})

it.each([
  ['a clocked shift', shift()],
  ['approved added time', shift({ entry_method: 'manual', approval_status: 'approved' })],
  ['time a manager added', shift({ entry_method: 'manual', admin_override: true })],
])('offers no Remove for %s', async (_label, entry) => {
  vi.mocked(myTimeApi.entries).mockResolvedValue({ data: [entry] })
  open()
  fireEvent.click(await screen.findByRole('button', { name: /8:00 AM/ }))
  expect(screen.getByRole('button', { name: 'Ask for a fix' })).toBeVisible()
  expect(screen.queryByRole('button', { name: 'Remove this shift' })).toBeNull()
})
