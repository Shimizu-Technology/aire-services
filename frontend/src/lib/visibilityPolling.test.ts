import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { startVisibilityAwarePolling } from './visibilityPolling'

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value: state,
  })
  document.dispatchEvent(new Event('visibilitychange'))
}

describe('startVisibilityAwarePolling', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    setVisibility('visible')
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('polls only while visible and refreshes when the page returns', async () => {
    const callback = vi.fn()
    const stop = startVisibilityAwarePolling(callback, 1_000)

    await vi.advanceTimersByTimeAsync(1_000)
    expect(callback).toHaveBeenCalledTimes(1)

    setVisibility('hidden')
    await vi.advanceTimersByTimeAsync(3_000)
    expect(callback).toHaveBeenCalledTimes(1)

    setVisibility('visible')
    await vi.runAllTicks()
    expect(callback).toHaveBeenCalledTimes(2)

    stop()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(callback).toHaveBeenCalledTimes(2)
  })

  it('can refresh on visibility without running a fallback interval', async () => {
    const callback = vi.fn()
    const stop = startVisibilityAwarePolling(callback, null)

    await vi.advanceTimersByTimeAsync(60_000)
    expect(callback).not.toHaveBeenCalled()

    setVisibility('hidden')
    setVisibility('visible')
    await vi.runAllTicks()
    expect(callback).toHaveBeenCalledTimes(1)

    stop()
  })
})
