import '@testing-library/jest-dom'
import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { formatElapsed } from '../../lib/formatElapsed'
import { LiveTimer } from './LiveTimer'

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })
  act(() => { document.dispatchEvent(new Event('visibilitychange')) })
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-11T09:00:00Z'))
})

afterEach(() => {
  setVisibility('visible')
  vi.useRealTimers()
})

describe('LiveTimer', () => {
  it('counts every second from the start time', () => {
    render(<LiveTimer since="2026-11-11T08:00:00Z" label="On the clock since 6:00 PM" />)
    const time = screen.getByText('1:00:00')
    expect(time.tagName).toBe('TIME')
    expect(time).toHaveAttribute('dateTime', '2026-11-11T08:00:00.000Z')
    act(() => { vi.advanceTimersByTime(3_000) })
    expect(time).toHaveTextContent('1:00:03')
  })

  it('gives screen readers a fixed label instead of the ticking number', () => {
    render(<LiveTimer since="2026-11-11T08:00:00Z" label="On the clock since 6:00 PM" />)
    expect(screen.getByText('On the clock since 6:00 PM')).toHaveClass('sr-only')
    const time = screen.getByText('1:00:00')
    expect(time).toHaveAttribute('aria-hidden', 'true')
    expect(time).toHaveAttribute('aria-live', 'off')
  })

  it('stops ticking while the page is hidden and catches up when it returns', () => {
    const setTimeout = vi.spyOn(window, 'setTimeout')
    render(<LiveTimer since="2026-11-11T08:00:00Z" label="On the clock" />)
    setVisibility('hidden')
    const scheduled = setTimeout.mock.calls.length
    act(() => { vi.advanceTimersByTime(60_000) })
    expect(screen.getByText('1:00:00')).toBeInTheDocument()
    expect(setTimeout.mock.calls.length).toBe(scheduled)

    setVisibility('visible')
    expect(screen.getByText('1:01:00')).toBeInTheDocument()
    act(() => { vi.advanceTimersByTime(1_000) })
    expect(screen.getByText('1:01:01')).toBeInTheDocument()
  })

  it('ticks on whole seconds of elapsed time, not a second after mounting', () => {
    // Mounted 400ms into a second: the next tick is 600ms later, not 1000ms.
    vi.setSystemTime(new Date('2026-11-11T09:00:00.400Z'))
    render(<LiveTimer since="2026-11-11T08:00:00Z" label="On the clock" />)
    expect(screen.getByText('1:00:00')).toBeInTheDocument()
    act(() => { vi.advanceTimersByTime(599) })
    expect(screen.getByText('1:00:00')).toBeInTheDocument()
    act(() => { vi.advanceTimersByTime(1) })
    expect(screen.getByText('1:00:01')).toBeInTheDocument()
    act(() => { vi.advanceTimersByTime(1_000) })
    expect(screen.getByText('1:00:02')).toBeInTheDocument()
  })

  it('shows a dash instead of crashing on an unreadable start', () => {
    render(<LiveTimer since="not a date" label="On the clock" />)
    expect(screen.getByText('–')).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByText('On the clock')).toBeInTheDocument()
    act(() => { vi.advanceTimersByTime(3_000) })
    expect(document.querySelector('time')).toBeNull()
  })

  it('holds still while paused', () => {
    render(<LiveTimer since="2026-11-11T08:55:00Z" label="On break" paused format="short" />)
    act(() => { vi.advanceTimersByTime(120_000) })
    expect(screen.getByText('5m')).toBeInTheDocument()
  })

  it('formats long and negative durations', () => {
    expect(formatElapsed(12 * 3_600_000 + 4 * 60_000 + 5_000)).toBe('12:04:05')
    expect(formatElapsed(-5_000)).toBe('0:00:00')
    expect(formatElapsed(3 * 3_600_000 + 12 * 60_000, 'short')).toBe('3h 12m')
  })
})
