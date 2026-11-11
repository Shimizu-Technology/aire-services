import '@testing-library/jest-dom'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ShellChromeProvider } from '../layouts/ShellChromeContext'
import { mockMatchMedia } from '../../test/matchMedia'
import { SelectionBar } from './SelectionBar'
import { TOAST_DEFAULT_DURATION, ToastProvider } from './Toast'
import type { ToastOptions } from './toastContext'
import { useToast } from './useToast'

function Trigger({ options }: { options: ToastOptions }) {
  const toast = useToast()
  return <button type="button" onClick={() => toast.show(options)}>Approve</button>
}

function renderToast(options: ToastOptions) {
  render(<ToastProvider><Trigger options={options} /></ToastProvider>)
  fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
}

let restoreMatchMedia: () => void

beforeEach(() => {
  vi.useFakeTimers()
  restoreMatchMedia = mockMatchMedia({ width: 390 })
})

afterEach(() => {
  vi.useRealTimers()
  restoreMatchMedia()
})

describe('Toast', () => {
  it('announces through a polite status region', () => {
    renderToast({ message: 'Approved 2 shifts for Marcus Quinata' })
    const region = screen.getByRole('status')
    expect(region).toHaveAttribute('aria-live', 'polite')
    expect(region).toHaveTextContent('Approved 2 shifts for Marcus Quinata')
  })

  it('closes after 10 seconds by default', () => {
    expect(TOAST_DEFAULT_DURATION).toBe(10_000)
    renderToast({ message: 'Saved' })
    act(() => { vi.advanceTimersByTime(9_900) })
    expect(screen.getByText('Saved')).toBeInTheDocument()
    act(() => { vi.advanceTimersByTime(100) })
    expect(screen.getByText('Saved').closest('[data-state]')).toHaveAttribute('data-state', 'closing')
    act(() => { vi.advanceTimersByTime(150) })
    expect(screen.queryByText('Saved')).not.toBeInTheDocument()
  })

  it('pauses while focused and resumes with the time that was left', () => {
    renderToast({ message: 'Approved 2 shifts', action: { label: 'Undo', onAction: vi.fn() } })
    act(() => { vi.advanceTimersByTime(4_000) })
    const undo = screen.getByRole('button', { name: 'Undo' })
    act(() => { undo.focus() })
    act(() => { vi.advanceTimersByTime(30_000) })
    expect(screen.getByText('Approved 2 shifts').closest('[data-state]')).toHaveAttribute('data-state', 'open')
    act(() => { undo.blur() })
    act(() => { vi.advanceTimersByTime(5_900) })
    expect(screen.getByText('Approved 2 shifts').closest('[data-state]')).toHaveAttribute('data-state', 'open')
    act(() => { vi.advanceTimersByTime(100) })
    expect(screen.getByText('Approved 2 shifts').closest('[data-state]')).toHaveAttribute('data-state', 'closing')
  })

  it('pauses under a mouse pointer and while the tab is hidden', () => {
    renderToast({ message: 'Saved' })
    const toast = screen.getByText('Saved').closest('[data-state]')!
    fireEvent.pointerEnter(toast, { pointerType: 'mouse' })
    act(() => { vi.advanceTimersByTime(20_000) })
    expect(toast).toHaveAttribute('data-state', 'open')
    fireEvent.pointerLeave(toast, { pointerType: 'mouse' })

    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    act(() => { document.dispatchEvent(new Event('visibilitychange')) })
    act(() => { vi.advanceTimersByTime(20_000) })
    expect(toast).toHaveAttribute('data-state', 'open')
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    act(() => { document.dispatchEvent(new Event('visibilitychange')) })
    act(() => { vi.advanceTimersByTime(10_000) })
    expect(toast).toHaveAttribute('data-state', 'closing')
  })

  it('runs its one action, closes and returns focus to where it came from', () => {
    const onAction = vi.fn()
    renderToast({ message: 'Approved 2 shifts', action: { label: 'Undo', onAction } })
    const trigger = screen.getByRole('button', { name: 'Approve' })
    const undo = screen.getByRole('button', { name: 'Undo' })
    act(() => { trigger.focus() })
    act(() => { undo.focus() })
    fireEvent.click(undo)
    expect(onAction).toHaveBeenCalledTimes(1)
    expect(trigger).toHaveFocus()
    act(() => { vi.advanceTimersByTime(150) })
    expect(screen.queryByText('Approved 2 shifts')).not.toBeInTheDocument()
  })

  it('shows one toast at a time and closes on Escape', () => {
    function Two() {
      const toast = useToast()
      return (
        <>
          <button type="button" onClick={() => toast.show({ message: 'First' })}>First</button>
          <button type="button" onClick={() => toast.show({ message: 'Second', action: { label: 'Undo', onAction: vi.fn() } })}>Second</button>
        </>
      )
    }
    render(<ToastProvider><Two /></ToastProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'First' }))
    fireEvent.click(screen.getByRole('button', { name: 'Second' }))
    expect(screen.queryByText('First', { selector: 'p' })).not.toBeInTheDocument()
    fireEvent.keyDown(screen.getByRole('button', { name: 'Undo' }), { key: 'Escape' })
    act(() => { vi.advanceTimersByTime(150) })
    expect(screen.queryByText('Second', { selector: 'p' })).not.toBeInTheDocument()
  })

  it('slides with full motion and only fades (100ms) with reduced motion', () => {
    const { unmount } = render(<ToastProvider><Trigger options={{ message: 'Saved' }} /></ToastProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
    const full = screen.getByText('Saved').closest('[data-motion]')!
    expect(full).toHaveAttribute('data-motion', 'full')
    expect(full).toHaveClass('starting:translate-y-4', 'duration-200')
    unmount()

    restoreMatchMedia()
    restoreMatchMedia = mockMatchMedia({ width: 390, reducedMotion: true })
    render(<ToastProvider><Trigger options={{ message: 'Saved' }} /></ToastProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
    const reduced = screen.getByText('Saved').closest('[data-motion]')!
    expect(reduced).toHaveAttribute('data-motion', 'reduced')
    expect(reduced.className).not.toContain('translate-y')
    expect(reduced).toHaveClass('duration-100')
    act(() => { vi.advanceTimersByTime(TOAST_DEFAULT_DURATION) })
    act(() => { vi.advanceTimersByTime(100) })
    expect(screen.queryByText('Saved')).not.toBeInTheDocument()
  })

  it('sits above the selection bar on desktop while one is showing', () => {
    render(
      <ShellChromeProvider>
        <ToastProvider>
          <Trigger options={{ message: 'Saved' }} />
          <SelectionBar count={2} noun={['shift', 'shifts']} onClear={vi.fn()} actions={null} />
        </ToastProvider>
      </ShellChromeProvider>,
    )
    expect(screen.getAllByRole('status')[0]).toHaveClass('lg:bottom-24')
  })

  it('says what is missing when there is no provider', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(() => render(<Trigger options={{ message: 'x' }} />)).toThrow('ToastProvider')
    vi.restoreAllMocks()
  })
})
