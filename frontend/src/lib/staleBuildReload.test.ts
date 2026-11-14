import { afterEach, describe, expect, it, vi } from 'vitest'
import { handleStaleBuild, installStaleBuildReload, RELOAD_GUARD_MS } from './staleBuildReload'

describe('stale build reload', () => {
  afterEach(() => {
    window.sessionStorage.clear()
    vi.restoreAllMocks()
  })

  it('reloads once when a page file from an older deploy fails to load', () => {
    const reload = vi.fn()
    expect(handleStaleBuild(1_000_000, reload)).toBe(true)
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('lets the error show instead of reloading in a loop', () => {
    const reload = vi.fn()
    handleStaleBuild(1_000_000, reload)
    expect(handleStaleBuild(1_000_000 + RELOAD_GUARD_MS - 1, reload)).toBe(false)
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('reloads again for a later deploy', () => {
    const reload = vi.fn()
    handleStaleBuild(1_000_000, reload)
    handleStaleBuild(1_000_000 + RELOAD_GUARD_MS, reload)
    expect(reload).toHaveBeenCalledTimes(2)
  })

  it('still reloads when session storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    const reload = vi.fn()
    expect(handleStaleBuild(1_000_000, reload)).toBe(true)
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('listens for vite:preloadError once installed', () => {
    const add = vi.spyOn(window, 'addEventListener')
    installStaleBuildReload()
    expect(add).toHaveBeenCalledWith('vite:preloadError', expect.any(Function))
  })
})
