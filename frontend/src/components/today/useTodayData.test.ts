import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { attention, cutoff, NOW } from '../../test/fixtures/today'
import { useTodayData } from './useTodayData'

const mocks = vi.hoisted(() => ({
  attention: vi.fn(),
  connection: vi.fn(),
  getPayrollCutoff: vi.fn(),
  getWhosWorking: vi.fn(),
}))
vi.mock('../../lib/api', () => ({ api: { getPayrollCutoff: mocks.getPayrollCutoff, getWhosWorking: mocks.getWhosWorking } }))
vi.mock('../../lib/api/attention', () => ({ attentionApi: { attention: mocks.attention, connection: mocks.connection } }))

const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(0) })

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date'] })
  vi.setSystemTime(new Date(NOW))
  mocks.attention.mockReset().mockResolvedValue({ data: attention() })
  mocks.connection.mockReset().mockResolvedValue({ data: {} })
  mocks.getPayrollCutoff.mockReset().mockResolvedValue({ data: cutoff() })
  mocks.getWhosWorking.mockReset().mockResolvedValue({ data: { workers: [] } })
})
afterEach(() => vi.useRealTimers())

describe('useTodayData', () => {
  it('shares one request among retries made while it is running and queues a single follow-up', async () => {
    let running = 0
    let maxRunning = 0
    const releases: Array<(value: unknown) => void> = []
    mocks.attention.mockImplementation(() => new Promise(resolve => {
      running += 1
      maxRunning = Math.max(maxRunning, running)
      releases.push(value => { running -= 1; resolve(value) })
    }))
    const { result } = renderHook(() => useTodayData({ payroll: true, team: true, connection: false }))
    await flush()
    expect(mocks.attention).toHaveBeenCalledTimes(1)

    // A retry and a reload after saving something, both while the first is out.
    act(() => { result.current.retry.attention(); result.current.retry.attention() })
    expect(mocks.attention).toHaveBeenCalledTimes(1)

    await act(async () => { releases[0]({ data: attention() }) })
    await flush()
    // Exactly one follow-up, started only after the first finished.
    expect(mocks.attention).toHaveBeenCalledTimes(2)
    await act(async () => { releases[1]({ data: attention() }) })
    await flush()
    expect(mocks.attention).toHaveBeenCalledTimes(2)
    expect(maxRunning).toBe(1)
    expect(result.current.attention.data).not.toBeNull()
  })

  it('keeps the last good answer and marks it stale when a refresh fails', async () => {
    const { result } = renderHook(() => useTodayData({ payroll: true, team: true, connection: false }))
    await flush()
    const first = result.current.attention.loadedAt
    mocks.attention.mockResolvedValue({ error: 'Something went wrong', status: 500 })
    act(() => result.current.retry.attention())
    await flush()
    expect(result.current.attention.data).not.toBeNull()
    expect(result.current.attention.error).toBe('Something went wrong')
    expect(result.current.attention.loadedAt).toBe(first)
  })
})
