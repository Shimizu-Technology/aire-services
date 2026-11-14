// After a deploy, a tab opened before it still runs the old build. Its pages
// load on demand, and the old page files are gone, so the next new page fails
// to load and the screen goes blank. Vite reports that as `vite:preloadError`;
// reloading once picks up the current build at the same URL.

const RELOADED_AT_KEY = 'aire.staleBuildReloadedAt'
// A second failure this soon after a reload isn't a stale tab (the file is
// really missing, or the network is down), so let the error show instead of
// reloading in a loop.
export const RELOAD_GUARD_MS = 30_000

function readReloadedAt(): number {
  try {
    return Number(window.sessionStorage.getItem(RELOADED_AT_KEY)) || 0
  } catch {
    return 0
  }
}

function writeReloadedAt(value: number) {
  try {
    window.sessionStorage.setItem(RELOADED_AT_KEY, String(value))
  } catch {
    // Storage can be unavailable (private browsing); the reload still helps.
  }
}

/**
 * Returns true when it reloaded the page. The original load error is left to
 * surface as usual (Vite's documented pattern); the reload replaces the page.
 */
export function handleStaleBuild(now = Date.now(), reload = () => window.location.reload()) {
  if (now - readReloadedAt() < RELOAD_GUARD_MS) return false
  writeReloadedAt(now)
  reload()
  return true
}

/** Run once at startup. */
export function installStaleBuildReload() {
  if (typeof window === 'undefined') return
  window.addEventListener('vite:preloadError', () => {
    handleStaleBuild()
  })
}
