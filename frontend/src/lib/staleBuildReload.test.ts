import { afterEach, describe, expect, it, vi } from 'vitest'
import { handleStaleBuild, installStaleBuildReload, RELOAD_GUARD_MS } from './staleBuildReload'
import { readPayStubToken, stashPayStubToken } from './payStubLinkToken'

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

  it('never reloads when session storage is unavailable, so it cannot loop', () => {
    vi.spyOn(window.sessionStorage, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(window.sessionStorage, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    const reload = vi.fn()
    expect(handleStaleBuild(1_000_000, reload)).toBe(false)
    expect(handleStaleBuild(1_000_000 + RELOAD_GUARD_MS * 2, reload)).toBe(false)
    expect(reload).not.toHaveBeenCalled()
  })

  it('does not reload when the guard is not kept (storage silently drops writes)', () => {
    vi.spyOn(window.sessionStorage, 'setItem').mockImplementation(() => undefined)
    const reload = vi.fn()
    expect(handleStaleBuild(1_000_000, reload)).toBe(false)
    expect(reload).not.toHaveBeenCalled()
  })

  it('keeps a pay stub link token held only in memory', () => {
    const token = 'a'.repeat(43)
    vi.spyOn(window.sessionStorage, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(window.sessionStorage, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    window.history.replaceState(null, '', `/stubs#t=${token}`)
    stashPayStubToken()
    const reload = vi.fn()
    expect(handleStaleBuild(1_000_000, reload)).toBe(false)
    expect(reload).not.toHaveBeenCalled()
    expect(readPayStubToken()).toBe(token)
    window.history.replaceState(null, '', '/')
  })

  it('listens for vite:preloadError once installed', () => {
    const add = vi.spyOn(window, 'addEventListener')
    installStaleBuildReload()
    expect(add).toHaveBeenCalledWith('vite:preloadError', expect.any(Function))
  })
})
