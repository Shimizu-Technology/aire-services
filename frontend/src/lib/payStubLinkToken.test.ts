import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const token = 'A'.repeat(43)

beforeEach(() => {
  window.sessionStorage.clear()
  vi.resetModules()
})
afterEach(() => window.history.replaceState(null, '', '/'))

it('moves the token out of the URL into this tab at startup', async () => {
  window.history.replaceState(null, '', `/stubs#t=${token}`)
  await import('./payStubLinkTokenGuard')

  expect(window.location.href).toBe(`${window.location.origin}/stubs`)
  const { readPayStubToken } = await import('./payStubLinkToken')
  expect(readPayStubToken()).toBe(token)
})

it('leaves other pages and fragments alone', async () => {
  window.history.replaceState(null, '', `/admin/pay#t=${token}`)
  const { stashPayStubToken, readPayStubToken } = await import('./payStubLinkToken')
  expect(stashPayStubToken()).toBe(false)
  expect(window.location.hash).toBe(`#t=${token}`)
  expect(readPayStubToken()).toBeNull()

  window.history.replaceState(null, '', '/stubs#section')
  expect(stashPayStubToken()).toBe(false)
})

it('cleans a second link opened in the same tab and announces it', async () => {
  window.history.replaceState(null, '', `/stubs#t=${token}`)
  const { installPayStubTokenGuard, readPayStubToken, PAY_STUB_TOKEN_EVENT } = await import('./payStubLinkToken')
  installPayStubTokenGuard()
  const announced = vi.fn()
  window.addEventListener(PAY_STUB_TOKEN_EVENT, announced)

  const other = 'B'.repeat(43)
  window.history.replaceState(null, '', `/stubs#t=${other}`)
  window.dispatchEvent(new HashChangeEvent('hashchange'))

  expect(window.location.href).toBe(`${window.location.origin}/stubs`)
  expect(readPayStubToken()).toBe(other)
  expect(announced).toHaveBeenCalledTimes(1)
  window.removeEventListener(PAY_STUB_TOKEN_EVENT, announced)
})

it('forgets an earlier token when a malformed link is opened', async () => {
  window.sessionStorage.setItem('aire.payStubLinkToken', token)
  window.history.replaceState(null, '', '/stubs#t=short')
  const { stashPayStubToken, readPayStubToken } = await import('./payStubLinkToken')
  expect(stashPayStubToken()).toBe(true)
  expect(readPayStubToken()).toBeNull()
  expect(window.location.hash).toBe('')
})
