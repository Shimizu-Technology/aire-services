import type { ReactNode } from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import WhosWorking from './WhosWorking'

const mocks = vi.hoisted(() => ({
  getWhosWorking: vi.fn(),
  getTimeCategories: vi.fn(),
  getOrCreateConsumer: vi.fn(),
  disconnectConsumer: vi.fn(),
  unsubscribe: vi.fn(),
  callbacks: undefined as undefined | {
    connected: () => void
    disconnected: () => void
    received: (data: { type: string }) => void
  },
}))

vi.mock('../../lib/api', () => ({
  api: {
    getWhosWorking: mocks.getWhosWorking,
    getTimeCategories: mocks.getTimeCategories,
  },
  getAuthTokenValue: vi.fn(),
}))

vi.mock('../../lib/cable', () => ({
  getOrCreateConsumer: mocks.getOrCreateConsumer,
  disconnectConsumer: mocks.disconnectConsumer,
}))

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: { children: ReactNode }) => <div {...props}>{children}</div>,
  },
  AnimatePresence: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

describe('WhosWorking refresh strategy', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.clearAllMocks()
    mocks.callbacks = undefined
    mocks.getWhosWorking.mockResolvedValue({ data: { workers: [] } })
    mocks.getTimeCategories.mockResolvedValue({ data: { time_categories: [] } })
    mocks.getOrCreateConsumer.mockResolvedValue({
      subscriptions: {
        create: vi.fn((_identifier, callbacks) => {
          mocks.callbacks = callbacks
          return { unsubscribe: mocks.unsubscribe }
        }),
      },
    })
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('uses cable events while connected and restores polling after disconnect', async () => {
    render(<WhosWorking alwaysShow />)

    expect(await screen.findByText("Today's Team")).toBeInTheDocument()
    await waitFor(() => expect(mocks.callbacks).toBeDefined())
    expect(mocks.getWhosWorking).toHaveBeenCalledTimes(1)

    act(() => mocks.callbacks?.connected())
    await act(() => vi.advanceTimersByTimeAsync(60_000))
    expect(mocks.getWhosWorking).toHaveBeenCalledTimes(1)

    act(() => mocks.callbacks?.received({ type: 'time_clock_update' }))
    await waitFor(() => expect(mocks.getWhosWorking).toHaveBeenCalledTimes(2))

    act(() => mocks.callbacks?.disconnected())
    await act(() => vi.advanceTimersByTimeAsync(60_000))
    expect(mocks.getWhosWorking).toHaveBeenCalledTimes(3)
  })
})
