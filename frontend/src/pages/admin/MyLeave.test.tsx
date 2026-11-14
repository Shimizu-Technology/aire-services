import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { api, type LeaveRequest } from '../../lib/api'
import MyLeave from './MyLeave'
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
      <MyLeave />
    </MemoryRouter>,
  )

it('sends a date range and the note without a half-day control or generated prefix', async () => {
  const create = vi
    .spyOn(api, 'createLeaveRequest')
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
  const cancel = vi.spyOn(api, 'cancelLeaveRequest').mockResolvedValue({
    data: { leave_request: { ...request, status: 'cancelled' } },
    status: 200,
  })
  open()
  fireEvent.click(await screen.findByRole('button', { name: 'Cancel request' }))
  await waitFor(() => expect(cancel).toHaveBeenCalledWith(9))
  expect(
    await screen.findByText('Your request was cancelled.'),
  ).toBeInTheDocument()
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
  vi.spyOn(api, 'createLeaveRequest').mockResolvedValue({
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
  expect(api.createLeaveRequest).toHaveBeenCalledTimes(1)
})
