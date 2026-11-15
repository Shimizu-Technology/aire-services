import { act, fireEvent, renderHook, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { reviewEntry } from '../../test/approvalFixtures'
import { approvalsApi, type ReviewBatch } from '../../lib/api/approvals'
import { ToastProvider } from '../ui'
import { useReviewBatch, type ApprovalResult } from './useReviewBatch'
vi.mock('../../lib/api/approvals', () => ({
  approvalsApi: { review: vi.fn(), undo: vi.fn(), entry: vi.fn() },
}))
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
  vi.mocked(approvalsApi.entry).mockResolvedValue({})
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
    expect(vi.mocked(approvalsApi.review).mock.calls.map((call) => call[0])).toEqual([
      items(230).slice(0, 100),
      items(230).slice(100, 200),
      items(230).slice(200),
    ])
    expect(
      new Set(vi.mocked(approvalsApi.review).mock.calls.map((call) => call[1])).size,
    ).toBe(3)
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
    expect(vi.mocked(approvalsApi.review).mock.calls.map((call) => call[0].length)).toEqual([
      2, 2, 1,
    ])
    expect(
      vi
        .mocked(approvalsApi.review)
        .mock.calls.flatMap((call) => call[0])
        .every((item) => item.approve_overtime === false && !('overtime_hours' in item)),
    ).toBe(true)
  })
  it('blocks synchronous double taps and retains the idempotency key after an uncertain response', async () => {
    let resolve!: (value: Awaited<ReturnType<typeof approvalsApi.review>>) => void
    vi.mocked(approvalsApi.review).mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done
        }),
    )
    const { result } = renderHook(() => useReviewBatch(vi.fn()), { wrapper })
    let pending!: Promise<ApprovalResult>
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
    vi.mocked(approvalsApi.review)
      .mockResolvedValueOnce(ok('one'))
      .mockResolvedValueOnce(ok('two'))
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
    expect(result.current.undoBatches.map((batch) => batch.id)).toEqual(['two'])
    expect(approvalsApi.undo).toHaveBeenCalledTimes(2)
    await waitFor(() => expect(result.current.busy).toBe(false))
  })
})

it.each([undefined, 502, 503, 504])(
  'keeps the key and reports unknown for status %s',
  async (status) => {
    vi.mocked(approvalsApi.review).mockResolvedValueOnce({ status, error: 'Unavailable' })
    const reload = vi.fn()
    const { result } = renderHook(() => useReviewBatch(reload), { wrapper })
    await act(async () =>
      expect(await result.current.approve(items(1), 100, 'Approved')).toBe('unknown'),
    )
    expect(result.current.notice).toContain("We couldn't confirm this shift was approved.")
    expect(result.current.notice).not.toContain("weren't approved")
    const key = vi.mocked(approvalsApi.review).mock.calls[0][1]
    vi.mocked(approvalsApi.review).mockResolvedValueOnce(ok('recovered'))
    await act(async () =>
      expect(await result.current.approve(items(1), 100, 'Approved')).toBe('ok'),
    )
    expect(vi.mocked(approvalsApi.review).mock.calls[1][1]).toBe(key)
    expect(reload).toHaveBeenCalledTimes(2)
  },
)

it('recovers Undo for a committed 503 by checking saved states before replaying the same key', async () => {
  const row = reviewEntry(1)
  const payload = items(1)
  vi.mocked(approvalsApi.review).mockResolvedValueOnce({ status: 503, error: 'Restart' })
  const { result } = renderHook(() => useReviewBatch(vi.fn()), { wrapper })
  await act(async () => {
    await result.current.approve(payload, 100, 'Approved', 'ordinary', [row])
  })
  const key = vi.mocked(approvalsApi.review).mock.calls[0][1]
  vi.mocked(approvalsApi.entry).mockResolvedValueOnce({ data: { time_entry: row } })
  await act(async () => {
    await result.current.refresh()
  })
  expect(approvalsApi.review).toHaveBeenCalledTimes(1) // Reload cannot approve pending time.
  vi.mocked(approvalsApi.entry).mockResolvedValueOnce({
    data: { time_entry: { ...row, approval_status: 'approved' } },
  })
  vi.mocked(approvalsApi.review).mockResolvedValueOnce(ok('recovered'))
  await act(async () => {
    await result.current.refresh()
  })
  expect(vi.mocked(approvalsApi.review).mock.calls[1]).toEqual([payload, key, 'ordinary'])
  expect(result.current.undoBatches[0]).toMatchObject({ id: 'recovered', count: 1 })
})

it('keeps previous batches when a later chunk or Undo returns 503', async () => {
  vi.mocked(approvalsApi.review)
    .mockResolvedValueOnce(ok('first'))
    .mockResolvedValueOnce({ status: 503 })
  const { result } = renderHook(() => useReviewBatch(vi.fn()), { wrapper })
  await act(async () => {
    await result.current.approve(items(2), 1, 'Approved')
  })
  expect(result.current.undoBatches.map((row) => row.id)).toEqual(['first'])
  vi.mocked(approvalsApi.undo).mockResolvedValueOnce({ status: 503 })
  await act(async () => {
    await result.current.undo(result.current.undoBatches)
  })
  expect(result.current.undoBatches.map((row) => row.id)).toEqual(['first'])
  expect(result.current.notice).toContain("couldn't confirm whether Undo saved")
})

it.each([
  [409, 'conflict'],
  [422, 'rejected'],
] as const)('distinguishes a known %s outcome', async (status, outcome) => {
  vi.mocked(approvalsApi.review).mockResolvedValueOnce({ status, error: 'Refused' })
  const { result } = renderHook(() => useReviewBatch(vi.fn()), { wrapper })
  await act(async () =>
    expect(await result.current.approve(items(1), 100, 'Approved')).toBe(outcome),
  )
})

it('toast Undo undoes only the latest action while older batches remain available', async () => {
  vi.mocked(approvalsApi.review)
    .mockResolvedValueOnce(ok('older'))
    .mockResolvedValueOnce(ok('latest'))
  vi.mocked(approvalsApi.undo).mockResolvedValue({ data: { undone_count: 1 } })
  const { result } = renderHook(() => useReviewBatch(vi.fn()), { wrapper })
  await act(async () => {
    await result.current.approve(items(1), 100, 'First')
  })
  await act(async () => {
    await result.current.approve([{ ...items(1)[0], id: 2 }], 100, 'Second')
  })
  fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
  await waitFor(() => expect(approvalsApi.undo).toHaveBeenCalledWith('latest'))
  expect(approvalsApi.undo).toHaveBeenCalledOnce()
  await waitFor(() =>
    expect(result.current.undoBatches.map((batch) => batch.id)).toEqual(['older']),
  )
})

it('resolves unchanged pending outcomes as Not saved and keeps their retry key', async () => {
  const payload = items(1)
  vi.mocked(approvalsApi.review).mockResolvedValueOnce({ status: 503 })
  const { result } = renderHook(() => useReviewBatch(vi.fn()), { wrapper })
  await act(async () => {
    await result.current.approve(payload, 100, 'Approved')
  })
  const key = vi.mocked(approvalsApi.review).mock.calls[0][1]
  vi.mocked(approvalsApi.entry).mockResolvedValueOnce({
    data: { time_entry: reviewEntry(1, 1, { version: payload[0].version }) },
  })
  await act(async () => {
    await result.current.refresh()
  })
  expect(result.current.notice).toBe(
    'Not saved. The list is up to date; you can approve again.',
  )
  expect(approvalsApi.review).toHaveBeenCalledOnce()
  vi.mocked(approvalsApi.review).mockResolvedValueOnce(ok('retried'))
  await act(async () => {
    await result.current.approve(payload, 100, 'Approved')
  })
  expect(vi.mocked(approvalsApi.review).mock.calls[1][1]).toBe(key)
})

it('does not turn a changed pending version into a Not saved verdict', async () => {
  vi.mocked(approvalsApi.review).mockResolvedValueOnce({ status: 503 })
  const { result } = renderHook(() => useReviewBatch(vi.fn()), { wrapper })
  await act(async () => {
    await result.current.approve(items(1), 100, 'Approved')
  })
  vi.mocked(approvalsApi.entry).mockResolvedValueOnce({
    data: { time_entry: reviewEntry(1, 1, { version: 999 }) },
  })
  await act(async () => {
    await result.current.refresh()
  })
  expect(result.current.notice).not.toContain('Not saved')
})

it.each([
  undefined,
  {},
  {
    review_batch_id: 'bad',
    undo_expires_at: '2026-11-14T22:00:00Z',
    approved_count: 1,
    time_entries: [null],
  },
])('retains the key for a 2xx invalid or empty body: %s', async (data) => {
  vi.mocked(approvalsApi.review).mockResolvedValueOnce({
    status: 201,
    data: data as unknown as ReviewBatch,
  })
  const { result } = renderHook(() => useReviewBatch(vi.fn()), { wrapper })
  await act(async () =>
    expect(await result.current.approve(items(1), 100, 'Approved')).toBe('unknown'),
  )
  expect(result.current.notice).toBe(
    "We couldn't confirm this shift was approved. Reload before deciding again.",
  )
  const key = vi.mocked(approvalsApi.review).mock.calls[0][1]
  vi.mocked(approvalsApi.review).mockResolvedValueOnce(ok('replay'))
  await act(async () => {
    await result.current.approve(items(1), 100, 'Approved')
  })
  expect(vi.mocked(approvalsApi.review).mock.calls[1][1]).toBe(key)
})

it('does not create an empty toast for an Undo with nothing new', async () => {
  const { result } = renderHook(() => useReviewBatch(vi.fn()), { wrapper })
  await act(async () => {
    await result.current.undo([])
  })
  expect(screen.getByRole('status').childElementCount).toBe(0)
  vi.mocked(approvalsApi.undo).mockResolvedValueOnce({ code: 'already_undone', status: 409 })
  await act(async () => {
    await result.current.undo([
      { id: 'already', count: 1, expiresAt: '2026-11-14T22:00:00Z' },
    ])
  })
  expect(screen.getByRole('status').childElementCount).toBe(0)
})

it('uses singular shift copy when Undo restores one shift', async () => {
  vi.mocked(approvalsApi.undo).mockResolvedValue({ data: { undone_count: 1 } })
  const { result } = renderHook(() => useReviewBatch(vi.fn()), { wrapper })
  await act(async () => {
    await result.current.undo([{ id: 'one', count: 1, expiresAt: '2099-01-01T00:00:00Z' }])
  })
  expect(result.current.notice).toBe('Moved 1 shift back to waiting.')
})

it('returns only the original replay’s saved entry versions as confirmation', async () => {
  vi.mocked(approvalsApi.review).mockResolvedValueOnce({ error: 'Unavailable', status: 503 })
  const { result } = renderHook(() => useReviewBatch(vi.fn()), { wrapper })
  await act(async () => {
    await result.current.approve(items(1), 100, 'Approved')
  })
  vi.mocked(approvalsApi.entry).mockResolvedValue({
    data: { time_entry: reviewEntry(1, 1, { version: 7, approval_status: 'approved' }) },
  })
  vi.mocked(approvalsApi.review).mockResolvedValue({
    data: {
      review_batch_id: 'original',
      undo_expires_at: '2099-11-14T00:00:00Z',
      approved_count: 1,
      time_entries: [
        { id: 1, version: 7, approval_status: 'approved', overtime_status: 'none' },
      ],
    },
  })
  let confirmed: ReadonlyMap<number, number> | undefined
  await act(async () => {
    confirmed = await result.current.refresh()
  })
  expect(confirmed?.get(1)).toBe(7)
  expect(vi.mocked(approvalsApi.review).mock.calls[1][1]).toBe(
    vi.mocked(approvalsApi.review).mock.calls[0][1],
  )
})


it('announces a stale approval in a toast with the current approver and next step', async () => {
  vi.mocked(approvalsApi.review).mockResolvedValueOnce({ status: 409, error: 'Nothing was approved.' })
  vi.mocked(approvalsApi.entry).mockResolvedValueOnce({ data: { time_entry: {
    ...reviewEntry(1, 1), approval_status: 'approved', approved_by: { id: 3, full_name: 'Roke' },
  } } })
  const reload = vi.fn().mockResolvedValue(undefined)
  const { result } = renderHook(() => useReviewBatch(reload), { wrapper })
  await act(async () => { await result.current.approve(items(1), 100, 'Approved') })
  expect(reload).toHaveBeenCalledOnce()
  expect(screen.getByRole('status')).toHaveTextContent('Roke already approved this. The list has been refreshed.')
  expect(result.current.undoBatches).toEqual([])
})

it('settles a never-resolving approval, preserves earlier Undo and retries with the same key', async () => {
  vi.useFakeTimers()
  try {
    const reload = vi.fn().mockResolvedValue(undefined)
    vi.mocked(approvalsApi.review).mockResolvedValueOnce(ok('earlier'))
    const { result } = renderHook(() => useReviewBatch(reload), { wrapper })
    await act(async () => { await result.current.approve(items(1), 1, 'Earlier') })
    vi.mocked(approvalsApi.review).mockImplementationOnce(() => new Promise(() => {}))
    const payload = [{ ...items(1)[0], id: 2 }]
    let pending!: Promise<ApprovalResult>
    act(() => { pending = result.current.approve(payload, 1, 'Later') })
    expect(result.current.busy).toBe(true)
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
    expect(await pending).toBe('unknown')
    expect(result.current.busy).toBe(false)
    expect(result.current.notice).toBe("We couldn't confirm that approval. The list has been refreshed — check before approving again.")
    expect(reload).toHaveBeenCalledTimes(2)
    expect(result.current.undoBatches.map(batch => batch.id)).toEqual(['earlier'])
    vi.mocked(approvalsApi.undo).mockResolvedValueOnce({ data: { undone_count: 1 } })
    await act(async () => { await result.current.undo(result.current.undoBatches) })
    expect(approvalsApi.undo).toHaveBeenCalledWith('earlier')
    const key = vi.mocked(approvalsApi.review).mock.calls[1][1]
    vi.mocked(approvalsApi.review).mockResolvedValueOnce(ok('retry'))
    await act(async () => { await result.current.approve(payload, 1, 'Retry') })
    expect(vi.mocked(approvalsApi.review).mock.calls[2][1]).toBe(key)
  } finally { vi.useRealTimers() }
})

it('refuses an already-undone 200 replay without remembering or committing it', async () => {
  const committed = vi.fn()
  vi.mocked(approvalsApi.review).mockResolvedValueOnce({ status: 200, data: { ...ok('undone').data, undone: true } })
  const { result } = renderHook(() => useReviewBatch(vi.fn(), committed), { wrapper })
  await act(async () => { expect(await result.current.approve(items(1), 100, 'Approved')).toBe('rejected') })
  expect(result.current.undoBatches).toEqual([])
  expect(committed).not.toHaveBeenCalled()
  expect(screen.getByRole('status')).toHaveTextContent('This approval was already undone.')
})

it('toast Undo reloads the latest filter callback after rerender', async () => {
  const oldReload = vi.fn()
  const newReload = vi.fn()
  vi.mocked(approvalsApi.review).mockResolvedValueOnce(ok('batch'))
  vi.mocked(approvalsApi.undo).mockResolvedValueOnce({ data: { undone_count: 1 } })
  const { result, rerender } = renderHook(({ reload }) => useReviewBatch(reload), { wrapper, initialProps: { reload: oldReload } })
  await act(async () => { await result.current.approve(items(1), 100, 'Approved') })
  rerender({ reload: newReload })
  fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
  await waitFor(() => expect(newReload).toHaveBeenCalledOnce())
  expect(oldReload).toHaveBeenCalledOnce()
})

it('refuses an undone replay during recovery without restoring Undo', async () => {
  vi.mocked(approvalsApi.review).mockResolvedValueOnce({ status: 503 })
  const committed = vi.fn()
  const { result } = renderHook(() => useReviewBatch(vi.fn(), committed), { wrapper })
  await act(async () => { await result.current.approve(items(1), 100, 'Approved') })
  vi.mocked(approvalsApi.entry).mockResolvedValueOnce({
    data: { time_entry: reviewEntry(1, 1, { approval_status: 'approved' }) },
  })
  vi.mocked(approvalsApi.review).mockResolvedValueOnce({
    status: 200, data: { ...ok('already-undone').data, undone: true },
  })
  await act(async () => { expect((await result.current.refresh())?.size).toBe(0) })
  expect(result.current.undoBatches).toEqual([])
  expect(committed).not.toHaveBeenCalled()
  expect(result.current.notice).toContain('already undone')
})

it('settles a never-resolving Undo and releases the lock for Reload', async () => {
  vi.useFakeTimers()
  try {
    const reload = vi.fn().mockResolvedValue(undefined)
    vi.mocked(approvalsApi.undo).mockImplementationOnce(() => new Promise(() => {}))
    const { result } = renderHook(() => useReviewBatch(reload), { wrapper })
    let pending!: Promise<void>
    act(() => { pending = result.current.undo([{ id: 'lost', count: 1, expiresAt: '2026-11-15T23:00:00Z' }]) })
    expect(result.current.busy).toBe(true)
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); await pending })
    expect(result.current.busy).toBe(false)
    expect(result.current.notice).toContain("couldn't confirm whether Undo saved")
    await act(async () => { await result.current.refresh() })
    expect(reload).toHaveBeenCalledTimes(2)
  } finally { vi.useRealTimers() }
})

it('restores unexpired Undo batches after navigation and keeps viewers separate', async () => {
  sessionStorage.clear()
  const saved = { ...ok('restored').data, undo_expires_at: new Date(Date.now() + 900000).toISOString() }
  vi.mocked(approvalsApi.review).mockResolvedValue({ data: saved })
  const first = renderHook(() => useReviewBatch(vi.fn(), undefined, 17), { wrapper })
  await act(async () => { await first.result.current.approve(items(1), 100, 'Approved') })
  first.unmount()
  const next = renderHook(() => useReviewBatch(vi.fn(), undefined, 17), { wrapper })
  expect(next.result.current.undoBatches).toMatchObject([{ id: 'restored', count: 1 }])
  const other = renderHook(() => useReviewBatch(vi.fn(), undefined, 18), { wrapper })
  expect(other.result.current.undoBatches).toEqual([])
  next.unmount()
  sessionStorage.setItem('aire.approvals.undo.17', JSON.stringify([{ id: 'expired', count: 1, expiresAt: new Date(Date.now() - 1).toISOString() }]))
  const expired = renderHook(() => useReviewBatch(vi.fn(), undefined, 17), { wrapper })
  expect(expired.result.current.undoBatches).toEqual([])
  sessionStorage.clear()
})
