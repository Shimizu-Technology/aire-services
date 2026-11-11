import type { ReactNode } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
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

  it('shows an 08:00 Guam punch regardless of the device timezone', async () => {
    mocks.getWhosWorking.mockResolvedValue({ data: { workers: [{
      user: { id: 7, display_name: 'Guam Worker', full_name: 'Guam Worker', email: 'guam@example.test' },
      status: 'clocked_in', clock_in_at: '2026-10-24T22:00:00Z',
      total_hours_today: 1, breaks: [],
    }] } })
    render(<WhosWorking alwaysShow />)
    expect(await screen.findByText('In since 8:00 AM')).toBeInTheDocument()
  })

  it('flags someone still clocked in from an earlier day and links to fixing that entry', async () => {
    mocks.getWhosWorking.mockResolvedValue({ data: { workers: [{
      user: { id: 7, display_name: 'Caleb', full_name: 'Caleb Perez', email: 'caleb@example.test' },
      status: 'clocked_in', clock_in_at: '2026-11-09T21:02:00Z', completed_hours: 17.3, breaks: [],
      open_since_work_date: '2026-11-10', open_entry_id: 55,
    }] } })
    render(<MemoryRouter><WhosWorking alwaysShow /></MemoryRouter>)
    expect(await screen.findByText(/Still clocked in since Tue, Nov 10/)).toHaveTextContent('Still clocked in since Tue, Nov 10, 7:02 AM')
    expect(screen.getByText('1 active')).toBeInTheDocument()
    expect(screen.getByText('Check clock-out')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Fix clock-out' })).toHaveAttribute('href', '/admin/time?entry_id=55&date=2026-11-10&view=day&user_id=7')
    expect(screen.queryByText(/In since/)).not.toBeInTheDocument()
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
  it('shows returned failures and can retry instead of claiming nobody is working', async () => {
    mocks.getWhosWorking.mockResolvedValueOnce({ error: 'Unavailable' })
    render(<WhosWorking alwaysShow />)
    await screen.findByText('Unable to load team status')
    expect(screen.queryByText('No one is working or scheduled today')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await screen.findByText('No one is working or scheduled today')
  })

})
