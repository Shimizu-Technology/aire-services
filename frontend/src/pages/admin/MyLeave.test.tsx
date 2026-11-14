import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { api, setAuthTokenGetter, type LeaveRequest } from '../../lib/api'
import MyLeave from './MyLeave'
import { ToastProvider } from '../../components/ui'
import { todayInGuam } from '../../lib/payPeriods'
import { myTimeApi } from '../../lib/api/myTime'

const polling = vi.hoisted(() => ({
  tick: null as null | (() => Promise<void>),
}))
vi.mock('../../lib/visibilityPolling', () => ({
  startVisibilityAwarePolling: (tick: () => Promise<void>) => {
    polling.tick = tick
    return () => {}
  },
}))

vi.mock('../../contexts/AuthContext', () => ({
  useAuthContext: () => ({ currentUser: { id: 5 } }),
}))
const request = {
  id: 9,
  user: { id: 5 },
  leave_type: 'paid_time_off',
  start_date: '2026-12-01',
  end_date: '2026-12-01',
  status: 'pending',
  reason: 'Family visit',
  review_note: null,
} as LeaveRequest
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-14T12:00:00+10:00'))
  vi.restoreAllMocks()
  vi.spyOn(api, 'getLeaveRequests').mockResolvedValue({
    data: {
      leave_requests: [request],
      pagination: {
        current_page: 1,
        per_page: 100,
        total_count: 1,
        total_pages: 1,
      },
    },
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
    <MemoryRouter>
      <ToastProvider>
        <MyLeave />
      </ToastProvider>
    </MemoryRouter>,
  )

it('releases a frozen request after its deadline and reconciles before resubmission', async () => {
  setAuthTokenGetter(async () => null)
  const fetch = vi.fn<typeof globalThis.fetch>(
    () => new Promise<Response>(() => {}),
  )
  vi.stubGlobal('fetch', fetch)
  open()
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Request time off' }),
    ).toBeEnabled(),
  )
  vi.useFakeTimers()
  fireEvent.click(screen.getByRole('button', { name: 'Request time off' }))
  fireEvent.change(screen.getByLabelText(/Start date/), {
    target: { value: '2026-12-04' },
  })
  fireEvent.change(screen.getByLabelText(/End date/), {
    target: { value: '2026-12-04' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Send request' }))
  await act(async () => {
    await vi.advanceTimersByTimeAsync(20_000)
  })
  expect(screen.getByRole('alert')).toHaveTextContent('The reply was lost')
  expect(screen.getByRole('button', { name: 'Send request' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Close' })).toBeEnabled()
  fireEvent.click(screen.getByRole('button', { name: 'Close' }))
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0)
  })
  expect(screen.getByRole('button', { name: 'Request time off' })).toBeEnabled()
  expect(fetch).toHaveBeenCalledTimes(1)
})

it('releases a frozen cancellation and checks the saved status before retry', async () => {
  setAuthTokenGetter(async () => null)
  const fetch = vi.fn<typeof globalThis.fetch>(
    () => new Promise<Response>(() => {}),
  )
  vi.stubGlobal('fetch', fetch)
  open()
  const cancel = await screen.findByRole('button', { name: 'Cancel request' })
  vi.useFakeTimers()
  fireEvent.click(cancel)
  await act(async () => {
    await vi.advanceTimersByTimeAsync(20_000)
  })
  expect(screen.getByText(/The reply was lost/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Cancel request' })).toBeEnabled()
  expect(
    screen.getByRole('button', { name: 'Cancel request' }),
  ).not.toHaveAttribute('aria-busy', 'true')
  expect(api.getLeaveRequests).toHaveBeenCalledTimes(2)
  expect(fetch).toHaveBeenCalledTimes(1)
})

it('sends a date range and the note without a half-day control or generated prefix', async () => {
  const create = vi
    .spyOn(myTimeApi, 'requestLeave')
    .mockResolvedValue({ data: { leave_request: request }, status: 201 })
  open()
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Request time off' }),
    ).toBeEnabled(),
  )
  fireEvent.click(
    await screen.findByRole('button', { name: 'Request time off' }),
  )
  fireEvent.change(screen.getByLabelText(/Start date/), {
    target: { value: '2026-12-04' },
  })
  expect(
    screen.queryByRole('checkbox', { name: 'Half day' }),
  ).not.toBeInTheDocument()
  expect(
    screen.getByPlaceholderText("Say if it's a half day"),
  ).toBeInTheDocument()
  fireEvent.change(screen.getByLabelText(/End date/), {
    target: { value: '2026-12-05' },
  })
  fireEvent.change(screen.getByLabelText('Note'), {
    target: { value: 'Morning appointment' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Send request' }))
  await waitFor(() =>
    expect(create).toHaveBeenCalledWith({
      leave_type: 'paid_time_off',
      start_date: '2026-12-04',
      end_date: '2026-12-05',
      reason: 'Morning appointment',
    }),
  )
  expect(
    await screen.findByText('Your request was sent for approval.'),
  ).toBeInTheDocument()
})

it('cancels only a pending request owned by the viewer', async () => {
  const cancel = vi.spyOn(myTimeApi, 'cancelLeave').mockResolvedValue({
    data: { leave_request: { ...request, status: 'cancelled' } },
    status: 200,
  })
  open()
  fireEvent.click(await screen.findByRole('button', { name: 'Cancel request' }))
  await waitFor(() => expect(cancel).toHaveBeenCalledWith(9))
  expect(
    await screen.findByText('Cancelled your Dec 1 request.'),
  ).toBeInTheDocument()
})

it('can undo a cancellation by sending the same request again', async () => {
  vi.spyOn(myTimeApi, 'cancelLeave').mockResolvedValue({
    data: { leave_request: { ...request, status: 'cancelled' } },
    status: 200,
  })
  const send = vi.spyOn(myTimeApi, 'requestLeave').mockResolvedValue({
    data: { leave_request: { ...request, id: 10 } },
    status: 201,
  })
  open()
  fireEvent.click(await screen.findByRole('button', { name: 'Cancel request' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Undo' }))
  await waitFor(() =>
    expect(send).toHaveBeenCalledWith({
      leave_type: 'paid_time_off',
      start_date: '2026-12-01',
      end_date: '2026-12-01',
      reason: 'Family visit',
    }),
  )
  expect(
    await screen.findByText('Your request is back and waiting for approval.'),
  ).toBeInTheDocument()
})

it('puts Request time off above the list', async () => {
  open()
  const button = await screen.findByRole('button', { name: 'Request time off' })
  const first = await screen.findByText('Paid time off')
  expect(
    button.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy()
})

it('says so when the end date is before the start date', async () => {
  const send = vi.spyOn(myTimeApi, 'requestLeave')
  open()
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Request time off' }),
    ).toBeEnabled(),
  )
  fireEvent.click(screen.getByRole('button', { name: 'Request time off' }))
  fireEvent.change(screen.getByLabelText(/Start date/), {
    target: { value: '2026-12-10' },
  })
  fireEvent.change(screen.getByLabelText(/End date/), {
    target: { value: '2026-12-08' },
  })
  expect(
    screen.getByText("The end date can't be before the start date."),
  ).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Send request' }))
  expect(send).not.toHaveBeenCalled()
})

it('shows approved days in the current month only when those requests exist', async () => {
  const month = todayInGuam().slice(0, 7)
  vi.mocked(api.getLeaveRequests).mockResolvedValue({
    data: {
      leave_requests: [
        {
          ...request,
          status: 'approved',
          start_date: `${month}-03`,
          end_date: `${month}-04`,
        },
      ],
      pagination: {
        current_page: 1,
        per_page: 100,
        total_count: 1,
        total_pages: 1,
      },
    },
  })
  open()
  expect(
    await screen.findByText(/You have 2 days of time off already approved/),
  ).toBeInTheDocument()
})

it('filters another person’s requests even when a supervisor reuses MyLeave', async () => {
  vi.mocked(api.getLeaveRequests).mockResolvedValue({
    data: {
      leave_requests: [
        request,
        {
          ...request,
          id: 10,
          user: { ...request.user, id: 6 },
          reason: 'Other person',
        },
      ],
      pagination: {
        current_page: 1,
        per_page: 100,
        total_count: 2,
        total_pages: 1,
      },
    },
  })
  open()
  expect(await screen.findByText('Family visit')).toBeInTheDocument()
  expect(screen.queryByText('Other person')).not.toBeInTheDocument()
})

it('does not let a pre-submission load clear uncertainty or overwrite a failed fresh read', async () => {
  let finishOld!: (value: Awaited<ReturnType<typeof myTimeApi.leave>>) => void
  const leave = vi
    .spyOn(myTimeApi, 'leave')
    .mockResolvedValueOnce({ data: [request] })
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishOld = resolve
        }),
    )
    .mockResolvedValueOnce({ error: 'Fresh read failed' })
  vi.spyOn(myTimeApi, 'requestLeave').mockResolvedValue({
    error: 'Lost reply',
    status: 502,
  })
  open()
  await screen.findByText('Family visit')
  let oldRead!: Promise<void>
  act(() => {
    oldRead = polling.tick!()
  })
  fireEvent.click(screen.getByRole('button', { name: 'Request time off' }))
  fireEvent.change(screen.getByLabelText(/Start date/), {
    target: { value: '2026-12-04' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Send request' }))
  await screen.findByText(/The reply was lost/)
  fireEvent.click(screen.getByRole('button', { name: 'Close' }))
  await screen.findByText('Fresh read failed')
  await act(async () => {
    finishOld({ data: [] })
    await oldRead
  })
  expect(screen.getByText('Fresh read failed')).toBeInTheDocument()
  expect(
    screen.getByRole('button', { name: 'Request time off' }),
  ).toBeDisabled()
  leave.mockResolvedValueOnce({ data: [request] })
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Request time off' }),
    ).toBeEnabled(),
  )
  expect(myTimeApi.requestLeave).toHaveBeenCalledTimes(1)
})
