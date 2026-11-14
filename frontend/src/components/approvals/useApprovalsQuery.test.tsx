import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { approvalsApi, type ApprovalsResponse } from '../../lib/api/approvals'
import { reviewEntry } from '../../test/approvalFixtures'
import { useApprovalsQuery } from './useApprovalsQuery'
vi.mock('../../lib/api/approvals', () => ({ approvalsApi: { pending: vi.fn() } }))
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
