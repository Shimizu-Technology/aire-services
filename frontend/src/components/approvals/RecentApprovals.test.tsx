import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import RecentApprovals from './RecentApprovals'

const start = new Date('2026-11-14T09:26:00+10:00')
const earlier = { id: 'earlier', count: 1, expiresAt: '2026-11-14T09:31:00+10:00' }
const newest = { id: 'newest', count: 2, expiresAt: '2026-11-14T09:41:00+10:00' }

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(start)
})
afterEach(() => vi.useRealTimers())

it('shows the newest server deadline in Guam time and disappears exactly at expiry', () => {
  const onUndo = vi.fn()
  render(
    <RecentApprovals
      batches={[earlier, newest]}
      busy={false}
      online
      onUndo={onUndo}
    />,
  )
  expect(screen.getByRole('region', { name: 'Recent approvals' })).toHaveTextContent(
    'until 9:41 AM',
  )

  act(() => vi.advanceTimersByTime(5 * 60_000))
  fireEvent.click(screen.getByRole('button', { name: 'Undo 2 shifts' }))
  expect(onUndo).toHaveBeenCalledWith([newest])
  expect(screen.getByRole('region', { name: 'Recent approvals' })).toBeInTheDocument()

  act(() => vi.advanceTimersByTime(10 * 60_000 - 1))
  expect(screen.getByRole('button', { name: 'Undo 2 shifts' })).toBeInTheDocument()
  act(() => vi.advanceTimersByTime(1))
  expect(screen.queryByRole('region', { name: 'Recent approvals' })).not.toBeInTheDocument()
})

it('refreshes expiry when a suspended tab returns to focus', () => {
  render(
    <RecentApprovals
      batches={[newest]}
      busy={false}
      online
      onUndo={vi.fn()}
    />,
  )
  vi.setSystemTime(new Date('2026-11-14T09:42:00+10:00'))
  act(() => window.dispatchEvent(new Event('focus')))
  expect(screen.queryByRole('button', { name: 'Undo 2 shifts' })).not.toBeInTheDocument()
})

it('does not send expired batches if a timer was delayed', () => {
  const onUndo = vi.fn()
  render(
    <RecentApprovals
      batches={[newest]}
      busy={false}
      online
      onUndo={onUndo}
    />,
  )
  vi.setSystemTime(new Date('2026-11-14T09:42:00+10:00'))
  fireEvent.click(screen.getByRole('button', { name: 'Undo 2 shifts' }))
  expect(onUndo).not.toHaveBeenCalled()
  expect(screen.queryByRole('region', { name: 'Recent approvals' })).not.toBeInTheDocument()
})

it('lists newest first and undoes just the chosen batch, with person and multi-person labels', () => {
  const onUndo = vi.fn()
  const grace = { ...earlier, count: 2, people: [{ id: 1, name: 'Grace Torres' }] }
  const multiple = {
    ...newest,
    count: 14,
    people: Array.from({ length: 6 }, (_, id) => ({ id, name: `Person ${id}` })),
  }
  render(
    <RecentApprovals
      batches={[grace, multiple]}
      busy={false}
      online
      onUndo={onUndo}
    />,
  )
  expect(screen.getAllByRole('button').map(button => button.getAttribute('aria-label'))).toEqual([
    'Undo 14 shifts for 6 people',
    'Undo Grace Torres · 2 shifts',
  ])
  expect(screen.getByText('Grace Torres · 2 shifts · until 9:31 AM')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Undo Grace Torres · 2 shifts' }))
  expect(onUndo).toHaveBeenCalledWith([grace])
})
