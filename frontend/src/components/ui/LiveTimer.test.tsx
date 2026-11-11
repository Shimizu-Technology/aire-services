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
    const setInterval = vi.spyOn(window, 'setInterval')
    const clearInterval = vi.spyOn(window, 'clearInterval')
    render(<LiveTimer since="2026-11-11T08:00:00Z" label="On the clock" />)
    expect(setInterval).toHaveBeenCalledTimes(1)

    setVisibility('hidden')
    expect(clearInterval).toHaveBeenCalled()
    act(() => { vi.advanceTimersByTime(60_000) })
    expect(screen.getByText('1:00:00')).toBeInTheDocument()
    expect(setInterval).toHaveBeenCalledTimes(1)

    setVisibility('visible')
    expect(screen.getByText('1:01:00')).toBeInTheDocument()
    expect(setInterval).toHaveBeenCalledTimes(2)
    act(() => { vi.advanceTimersByTime(1_000) })
    expect(screen.getByText('1:01:01')).toBeInTheDocument()
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
