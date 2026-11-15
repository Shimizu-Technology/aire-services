import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { approvalsApi, type ApprovalsResponse } from '../../lib/api/approvals'
import { reviewEntry } from '../../test/approvalFixtures'
import { ToastProvider } from '../ui'
import { useApprovalsQuery } from './useApprovalsQuery'
import { useReviewBatch } from './useReviewBatch'
vi.mock('../../lib/api/approvals', () => ({
  approvalsApi: { pending: vi.fn(), review: vi.fn(), undo: vi.fn() },
}))
const data: ApprovalsResponse = {
  count: 1,
  pending_entries: [reviewEntry(1)],
  pagination: { current_page: 1, total_pages: 1, total_count: 1 },
  review_summary: {
    complete: true,
    batch_limit: 100,
    ordinary_count: 1,
    ordinary_hours: 8,
    needs_look_count: 0,
    by_person: [],
  },
}
beforeEach(() => {
  vi.clearAllMocks()
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
})
afterEach(() => vi.useRealTimers())
it('does not carry another filter’s rows or timestamp into a failed filter', async () => {
  vi.mocked(approvalsApi.pending)
    .mockResolvedValueOnce({ data })
    .mockResolvedValueOnce({ error: 'Unavailable' })
  const view = renderHook(
    ({ department }) => useApprovalsQuery({ approval_group: department }, false),
    { initialProps: { department: 'cfi' } },
  )
  await waitFor(() => expect(view.result.current.data).toEqual(data))
  expect(view.result.current.loadedAt).toBeInstanceOf(Date)
  view.rerender({ department: 'ops' })
  expect(view.result.current.loadedAt).toBeUndefined()
  await waitFor(() => expect(view.result.current.error).toBe('Unavailable'))
  expect(view.result.current.data).toBeUndefined()
  expect(view.result.current.loadedAt).toBeUndefined()
})
it('retains a same-filter cache on refresh failure', async () => {
  vi.mocked(approvalsApi.pending)
    .mockResolvedValueOnce({ data })
    .mockResolvedValueOnce({ error: 'Unavailable' })
  const { result } = renderHook(() => useApprovalsQuery({ approval_group: 'cfi' }, false))
  await waitFor(() => expect(result.current.data).toEqual(data))
  const at = result.current.loadedAt
  await act(async () => {
    await result.current.reload()
  })
  expect(result.current.data).toEqual(data)
  expect(result.current.loadedAt).toBe(at)
})
it('deduplicates focus/reload while pending, then times out before the next poll and recovers', async () => {
  vi.useFakeTimers()
  let signal: AbortSignal | undefined
  vi.mocked(approvalsApi.pending)
    .mockImplementationOnce((_params, passedSignal) => {
      signal = passedSignal
      return new Promise(() => {})
    })
    .mockResolvedValue({ data })
  const { result } = renderHook(() => useApprovalsQuery({ approval_group: 'cfi' }, false))
  await act(async () => {})
  act(() => {
    window.dispatchEvent(new Event('focus'))
    window.dispatchEvent(new Event('focus'))
  })
  expect(approvalsApi.pending).toHaveBeenCalledTimes(1)
  await act(async () => {
    await vi.advanceTimersByTimeAsync(30_000)
  })
  expect(signal?.aborted).toBe(true)
  expect(result.current.error).toBe('Approvals took too long. Try again.')
  expect(result.current.loading).toBe(false)
  await act(async () => {
    await vi.advanceTimersByTimeAsync(30_000)
  })
  expect(approvalsApi.pending).toHaveBeenCalledTimes(2)
  expect(result.current.data).toEqual(data)
  expect(result.current.error).toBeUndefined()
})

it.each(['approve', 'undo', 'refresh', 'retry'] as const)(
  '%s starts a fresh request and ignores a pending poll’s older snapshot',
  async (operation) => {
    const empty: ApprovalsResponse = {
      ...data,
      count: 0,
      pending_entries: [],
      pagination: { current_page: 1, total_pages: 1, total_count: 0 },
      review_summary: {
        ...data.review_summary,
        ordinary_count: 0,
        ordinary_hours: 0,
      },
    }
    const before = operation === 'undo' ? empty : data
    const after = operation === 'undo' ? data : empty
    let resolvePoll!: (response: { data: ApprovalsResponse }) => void
    let pollSignal: AbortSignal | undefined
    vi.mocked(approvalsApi.pending)
      .mockResolvedValueOnce({ data: before })
      .mockImplementationOnce((_params, signal) => {
        pollSignal = signal
        // Deliberately ignore abort to prove a late transport response is ignored.
        return new Promise((resolve) => {
          resolvePoll = resolve
        })
      })
      .mockResolvedValueOnce({ data: after })
    vi.mocked(approvalsApi.review).mockResolvedValue({
      data: {
        review_batch_id: 'fresh-batch',
        undo_expires_at: '2026-11-14T00:00:00Z',
        approved_count: 1,
        time_entries: [
          {
            id: 1,
            version: 2,
            approval_status: 'approved',
            overtime_status: 'none',
          },
        ],
      },
    })
    vi.mocked(approvalsApi.undo).mockResolvedValue({ data: { undone_count: 1 } })
    const { result } = renderHook(
      () => {
        const query = useApprovalsQuery({ approval_group: 'cfi' }, false)
        const batch = useReviewBatch(query.reloadFresh)
        return { query, batch }
      },
      { wrapper: ToastProvider },
    )
    await waitFor(() => expect(result.current.query.data).toEqual(before))
    act(() => window.dispatchEvent(new Event('focus')))
    await waitFor(() => expect(approvalsApi.pending).toHaveBeenCalledTimes(2))
    expect(pollSignal?.aborted).toBe(false)
    await act(async () => {
      if (operation === 'approve') {
        await result.current.batch.approve(
          [{
            id: 1,
            version: 1,
            approve_time: true,
            approve_overtime: false,
          }],
          100,
          'Approved 1 shift',
        )
      } else if (operation === 'undo') {
        await result.current.batch.undo([
          {
            id: 'previous-batch',
            count: 1,
            expiresAt: '2026-11-14T00:00:00Z',
          },
        ])
      } else if (operation === 'refresh') {
        await result.current.batch.refresh()
      } else {
        await result.current.query.reloadFresh()
      }
    })
    expect(approvalsApi.pending).toHaveBeenCalledTimes(3)
    expect(pollSignal?.aborted).toBe(true)
    expect(result.current.query.data).toEqual(after)
    await act(async () => resolvePoll({ data: before }))
    expect(result.current.query.data).toEqual(after)
    expect(result.current.query.error).toBeUndefined()
    expect(result.current.query.loading).toBe(false)
  },
)
