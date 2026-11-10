// The emailed pay stub link is /stubs#t=<token>. The token is a credential,
// so it must not stay in the address bar where analytics, extensions or a
// copied URL could pick it up. main.tsx imports this module first, before
// analytics starts: it moves the token into this tab's sessionStorage and
// rewrites the URL to a plain /stubs. The page then reads it from here.

export const PAY_STUB_PATH = '/stubs'
const STORAGE_KEY = 'aire.payStubLinkToken'
const TOKEN = /^[A-Za-z0-9_-]{43}$/

// Fallback for browsers that refuse sessionStorage (some private modes).
let memoryToken: string | null = null

/** Read the token from a link's URL fragment (`#t=...`). */
export function tokenFromHash(hash: string): string | null {
  const value = new URLSearchParams(hash.replace(/^#/, '')).get('t')
  return value && TOKEN.test(value) ? value : null
}

export function isPayStubPath(pathname: string): boolean {
  return pathname.replace(/\/+$/, '') === PAY_STUB_PATH
}

function store(token: string | null) {
  memoryToken = token
  try {
    if (token) window.sessionStorage.setItem(STORAGE_KEY, token)
    else window.sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    // Keep the in-memory copy.
  }
}

/**
 * On /stubs with `t=` in the fragment: keep the token for this tab and
 * replace the URL with a clean /stubs. A malformed token clears any earlier
 * one, so the page says the link is incomplete instead of opening an old link.
 * Returns true when the URL was cleaned.
 */
export function stashPayStubToken(): boolean {
  if (typeof window === 'undefined' || !isPayStubPath(window.location.pathname)) return false
  const fragment = window.location.hash.replace(/^#/, '')
  if (!new URLSearchParams(fragment).has('t')) return false

  store(tokenFromHash(fragment))
  window.history.replaceState(window.history.state, '', PAY_STUB_PATH)
  return true
}

/** The token for the link opened in this tab, if any. */
export function readPayStubToken(): string | null {
  let value: string | null = null
  try {
    value = window.sessionStorage.getItem(STORAGE_KEY)
  } catch {
    value = memoryToken
  }
  value ??= memoryToken
  return value && TOKEN.test(value) ? value : null
}

/** Fired after a second link opened in the same tab has been stashed. */
export const PAY_STUB_TOKEN_EVENT = 'aire:pay-stub-token'

/**
 * Run once at startup. Opening another emailed link in the same tab only
 * changes the fragment, so the same cleanup runs on every hashchange. This
 * listener is registered before analytics loads, so it runs first.
 */
export function installPayStubTokenGuard() {
  if (typeof window === 'undefined') return
  stashPayStubToken()
  window.addEventListener('hashchange', () => {
    if (stashPayStubToken()) window.dispatchEvent(new Event(PAY_STUB_TOKEN_EVENT))
  })
}
