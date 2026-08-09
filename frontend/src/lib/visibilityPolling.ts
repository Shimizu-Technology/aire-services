type PollCallback = () => void | Promise<void>

export function isPageVisible() {
  return document.visibilityState !== 'hidden'
}

/**
 * Poll while the page is visible and refresh once when a hidden page returns.
 * Pass null for intervalMs to keep only the refresh-on-visible behavior.
 */
export function startVisibilityAwarePolling(callback: PollCallback, intervalMs: number | null) {
  let stopped = false
  let inFlight = false

  const runIfVisible = () => {
    if (stopped || inFlight || !isPageVisible()) return

    inFlight = true
    Promise.resolve(callback())
      .catch(() => undefined)
      .finally(() => {
        inFlight = false
      })
  }

  const handleVisibilityChange = () => {
    if (isPageVisible()) runIfVisible()
  }

  const intervalId = intervalMs === null ? null : window.setInterval(runIfVisible, intervalMs)
  document.addEventListener('visibilitychange', handleVisibilityChange)

  return () => {
    stopped = true
    if (intervalId !== null) window.clearInterval(intervalId)
    document.removeEventListener('visibilitychange', handleVisibilityChange)
  }
}
