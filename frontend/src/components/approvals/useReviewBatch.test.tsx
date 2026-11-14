import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { approvalsApi } from '../../lib/api/approvals'
import { ToastProvider } from '../ui'
import { useReviewBatch } from './useReviewBatch'
vi.mock('../../lib/api/approvals', () => ({ approvalsApi: { review: vi.fn(), undo: vi.fn() } }))
const items = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    version: index + 4,
    approve_time: true,
    approve_overtime: false,
  }))
const ok = (id: string) => ({
  data: {
    review_batch_id: id,
    undo_expires_at: '2026-11-14T00:00:00Z',
    approved_count: 100,
    time_entries: [],
  },
})
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <ToastProvider>{children}</ToastProvider>
)
beforeEach(() => {
  vi.clearAllMocks()
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
})
describe('versioned batch review', () => {
  it('chunks by the API limit, reports partial 409, reloads and undoes every succeeded batch', async () => {
    const reload = vi.fn().mockResolvedValue(undefined)
    vi.mocked(approvalsApi.review)
      .mockResolvedValueOnce(ok('first'))
      .mockResolvedValueOnce(ok('second'))
      .mockResolvedValueOnce({
        status: 409,
        code: 'stale_entries',
        error: '2 shifts changed since you loaded this list. Nothing was approved.',
      })
    vi.mocked(approvalsApi.undo).mockResolvedValue({ data: { undone_count: 100 } })
    const { result } = renderHook(() => useReviewBatch(reload), { wrapper })
    await act(async () => {
      await result.current.approve(items(230), 100, 'Approved shifts')
    })
    expect(vi.mocked(approvalsApi.review).mock.calls.map(call => call[0])).toEqual([
      items(230).slice(0, 100),
      items(230).slice(100, 200),
      items(230).slice(200),
    ])
    expect(new Set(vi.mocked(approvalsApi.review).mock.calls.map(call => call[1])).size).toBe(3)
    expect(result.current.notice).toContain(
      "Approved 200 of 230 shifts. The other 30 weren't approved.",
    )
    expect(result.current.notice).toContain('2 shifts changed')
    expect(result.current.notice).not.toContain('Nothing was approved')
    expect(reload).toHaveBeenCalledOnce()
    await act(async () => {
      await result.current.undo(result.current.undoBatches)
    })
    expect(vi.mocked(approvalsApi.undo).mock.calls).toEqual([['second'], ['first']])
    expect(result.current.undoBatches).toEqual([])
    expect(reload).toHaveBeenCalledTimes(2)
  })
  it('reads a non-default batch limit and never adds overtime', async () => {
    vi.mocked(approvalsApi.review).mockResolvedValue(ok('batch'))
    const { result } = renderHook(() => useReviewBatch(vi.fn()), { wrapper })
    await act(async () => {
      await result.current.approve(items(5), 2, 'Approved')
    })
    expect(vi.mocked(approvalsApi.review).mock.calls.map(call => call[0].length)).toEqual([2, 2, 1])
    expect(
      vi
        .mocked(approvalsApi.review)
        .mock.calls.flatMap(call => call[0])
        .every(item => item.approve_overtime === false && !('overtime_hours' in item)),
    ).toBe(true)
  })
  it('blocks synchronous double taps and retains the idempotency key after an uncertain response', async () => {
    let resolve!: (value: Awaited<ReturnType<typeof approvalsApi.review>>) => void
    vi.mocked(approvalsApi.review).mockImplementationOnce(
      () =>
        new Promise(done => {
          resolve = done
        }),
    )
    const { result } = renderHook(() => useReviewBatch(vi.fn()), { wrapper })
    let pending!: Promise<boolean>
    act(() => {
      pending = result.current.approve(items(1), 100, 'Approved')
      void result.current.approve(items(1), 100, 'Approved')
    })
    expect(approvalsApi.review).toHaveBeenCalledOnce()
    await act(async () => {
      resolve({ error: 'Network error' })
      await pending
    })
    const firstKey = vi.mocked(approvalsApi.review).mock.calls[0][1]
    vi.mocked(approvalsApi.review).mockResolvedValue(ok('replay'))
    await act(async () => {
      await result.current.approve(items(1), 100, 'Approved')
    })
    expect(vi.mocked(approvalsApi.review).mock.calls[1][1]).toBe(firstKey)
  })
  it('shows server Undo refusal and continues undoing the other batches', async () => {
    vi.mocked(approvalsApi.review).mockResolvedValueOnce(ok('one')).mockResolvedValueOnce(ok('two'))
    const { result } = renderHook(() => useReviewBatch(vi.fn()), { wrapper })
    await act(async () => {
      await result.current.approve(items(2), 1, 'Approved')
    })
    vi.mocked(approvalsApi.undo)
      .mockResolvedValueOnce({
        status: 409,
        code: 'undo_refused',
        error: "Can't undo: already locked for payroll.",
      })
      .mockResolvedValueOnce({ data: { undone_count: 1 } })
    await act(async () => {
      await result.current.undo(result.current.undoBatches)
    })
    expect(result.current.notice).toContain("Can't undo: already locked for payroll.")
    expect(result.current.undoBatches.map(batch => batch.id)).toEqual(['two'])
    expect(approvalsApi.undo).toHaveBeenCalledTimes(2)
    await waitFor(() => expect(result.current.busy).toBe(false))
  })
})
