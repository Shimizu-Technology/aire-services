import { afterEach, expect, it, vi } from 'vitest'
import { api, setAuthTokenGetter } from '../api'
import { myTimeApi } from './myTime'
import { shift } from '../../test/employeeFixtures'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

it.each(['clockOut', 'status', 'entry'] as const)(
  'bounds a frozen %s request and aborts transport after 20s',
  async (method) => {
    vi.useFakeTimers()
    setAuthTokenGetter(async () => null)
    const fetch = vi.fn<typeof globalThis.fetch>(
      () => new Promise<Response>(() => {}),
    )
    vi.stubGlobal('fetch', fetch)
    const pending =
      method === 'entry' ? myTimeApi.entry(41) : myTimeApi[method]()
    await vi.advanceTimersByTimeAsync(20_000)
    const result = await pending
    expect(result.error).toMatch(/timed out/)
    expect(result.status).toBeUndefined()
    expect(fetch.mock.calls[0][1]?.signal?.aborted).toBe(true)
  },
)

it.each(['request', 'cancel'] as const)(
  'bounds a frozen leave %s as an unknown outcome',
  async (kind) => {
    vi.useFakeTimers()
    setAuthTokenGetter(async () => null)
    const fetch = vi.fn<typeof globalThis.fetch>(
      () => new Promise<Response>(() => {}),
    )
    vi.stubGlobal('fetch', fetch)
    const pending =
      kind === 'request'
        ? myTimeApi.requestLeave({
            leave_type: 'sick',
            start_date: '2026-12-01',
            end_date: '2026-12-01',
          })
        : myTimeApi.cancelLeave(9)
    await vi.advanceTimersByTimeAsync(20_000)
    const result = await pending
    expect(result.error).toMatch(/timed out/)
    expect(result.status).toBeUndefined()
    expect(fetch.mock.calls[0][1]?.signal?.aborted).toBe(true)
  },
)

it('sends changed employee fields and the correction reason with the viewed version without rewriting description', async () => {
  const update = vi
    .spyOn(api, 'updateTimeEntry')
    .mockResolvedValue({ data: { time_entry: shift() } })
  const entry = shift({ description: 'Original work note', break_minutes: 0 })
  const change = {
    start_time: entry.start_time!,
    end_time: '11:30',
    break_minutes: null,
    time_category_id: entry.time_category!.id,
    description: entry.description!,
  }
  await myTimeApi.askForFix(entry, change, 'Phone died.')
  expect(update).toHaveBeenLastCalledWith(
    entry.id,
    { end_time: '11:30', expected_version: entry.version },
    'Phone died.',
  )
  await myTimeApi.askForFix(
    { ...entry, end_time: '11:30' },
    { ...change, end_time: '11:40' },
    'Second correction.',
  )
  expect(update).toHaveBeenLastCalledWith(
    entry.id,
    { end_time: '11:40', expected_version: entry.version },
    'Second correction.',
  )
})

it('omits unchanged detailed breaks', async () => {
  const update = vi
    .spyOn(api, 'updateTimeEntry')
    .mockResolvedValue({ data: { time_entry: shift() } })
  const breaks = [
    {
      id: 1,
      start_time: '2026-11-14T09:00:00+10:00',
      end_time: '2026-11-14T09:15:00+10:00',
    },
  ]
  const entry = shift({
    breaks: breaks.map((row) => ({
      ...row,
      duration_minutes: 15,
      active: false,
    })),
    break_minutes: 15,
  })
  await myTimeApi.askForFix(
    entry,
    {
      start_time: '08:00',
      end_time: '11:00',
      break_minutes: 15,
      time_category_id: 2,
      description: '',
      breaks,
    },
    'Please review this shift.',
  )
  expect(update).toHaveBeenCalledWith(entry.id, { expected_version: entry.version }, 'Please review this shift.')
})
