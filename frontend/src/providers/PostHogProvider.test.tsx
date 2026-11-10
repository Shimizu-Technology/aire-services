import { cleanup, render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { CaptureResult, PostHogConfig } from 'posthog-js'
import mainSource from '../main.tsx?raw'

const posthog = vi.hoisted(() => ({ init: vi.fn(), capture: vi.fn() }))
vi.mock('posthog-js', () => ({ default: posthog }))
vi.mock('posthog-js/react', () => ({
  PostHogProvider: ({ children }: { children: React.ReactNode }) => children,
  usePostHog: () => posthog,
}))

const token = 'A'.repeat(43)

beforeEach(() => {
  vi.resetModules()
  posthog.init.mockReset()
  posthog.capture.mockReset()
  window.sessionStorage.clear()
  vi.stubEnv('VITE_PUBLIC_POSTHOG_KEY', 'phc_synthetic')
})
afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
  window.history.replaceState(null, '', '/')
})

function sentToPostHog(): string {
  return JSON.stringify([posthog.init.mock.calls.map(([key, config]) => [key, { ...config, before_send: undefined }]), posthog.capture.mock.calls])
}

async function startApp(path: string) {
  // The order main.tsx uses: the token guard, then analytics.
  await import('../lib/payStubLinkTokenGuard')
  const { PostHogPageView } = await import('./PostHogProvider')
  render(<MemoryRouter initialEntries={[path]}><PostHogPageView /></MemoryRouter>)
}

function initConfig(): Partial<PostHogConfig> {
  expect(posthog.init).toHaveBeenCalledTimes(1)
  return posthog.init.mock.calls[0][1] as Partial<PostHogConfig>
}

it('loads the token guard before anything else in main.tsx', () => {
  const firstImport = mainSource.split('\n').find((line) => line.startsWith('import '))
  expect(firstImport).toBe("import './lib/payStubLinkTokenGuard'")
})

it('sends nothing from an emailed pay stub link, and the token never reaches PostHog', async () => {
  window.history.replaceState(null, '', `/stubs#t=${token}`)
  await startApp('/stubs')

  expect(window.location.href).toBe(`${window.location.origin}/stubs`)
  expect(posthog.init).not.toHaveBeenCalled()
  expect(posthog.capture).not.toHaveBeenCalled()
  expect(sentToPostHog()).not.toContain(token)
})

it('records page views elsewhere without the URL fragment', async () => {
  window.history.replaceState(null, '', `/admin/pay?tab=links#t=${token}`)
  await startApp('/admin/pay')

  const config = initConfig()
  expect(config.disable_capture_url_hashes).toBe(true)
  expect(posthog.capture).toHaveBeenCalledWith('$pageview', { $current_url: `${window.location.origin}/admin/pay?tab=links`, $pathname: '/admin/pay' })
  expect(sentToPostHog()).not.toContain(token)
})

it('strips fragments from every event and drops pay stub page events before they are sent', async () => {
  window.history.replaceState(null, '', '/admin')
  await startApp('/admin')
  const beforeSend = initConfig().before_send as (event: CaptureResult | null) => CaptureResult | null

  const autocapture = beforeSend({
    uuid: '1',
    event: '$autocapture',
    properties: {
      $current_url: `https://aire.example/admin#t=${token}`,
      $referrer: `https://aire.example/stubs#t=${token}`,
      $pathname: `/admin#t=${token}`,
      $initial_current_url: `https://aire.example/admin#t=${token}`,
      other: 'kept',
    },
    $set_once: { $initial_current_url: `https://aire.example/admin#t=${token}` },
  })
  expect(autocapture?.properties).toEqual({
    $current_url: 'https://aire.example/admin',
    $referrer: 'https://aire.example/stubs',
    $pathname: '/admin',
    $initial_current_url: 'https://aire.example/admin',
    other: 'kept',
  })
  expect(JSON.stringify(autocapture)).not.toContain(token)

  expect(beforeSend({ uuid: '2', event: '$pageleave', properties: { $current_url: `https://aire.example/stubs#t=${token}` } })).toBeNull()
  expect(beforeSend({ uuid: '3', event: '$autocapture', properties: { $current_url: 'https://aire.example/stubs', $pathname: '/stubs' } })).toBeNull()
})
