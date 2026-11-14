import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { reviewEntry } from '../../test/approvalFixtures'
import OrdinaryGroups from './OrdinaryGroups'
import NeedsLookList from './NeedsLookList'

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-14T09:00:00+10:00'))
})
afterEach(() => vi.useRealTimers())

it('keeps compact group dates and hours in wrapping metadata', () => {
  const rows = [
    reviewEntry(1, 1, { hours: 8.8, work_date: '2026-11-10' }),
    reviewEntry(2, 1, { hours: 9.1, work_date: '2026-11-11' }),
  ]
  render(
    <OrdinaryGroups
      rows={rows}
      groupBy="person"
      selected={new Set()}
      onSelect={vi.fn()}
      onApprove={vi.fn().mockResolvedValue(undefined)}
      disabled={false}
    />,
  )
  const meta = screen.getByText('2 shifts · Nov 10–11 · 17.9h')
  expect(meta).toHaveClass('whitespace-normal')
  expect(meta).not.toHaveClass('truncate')
})

it('uses a single date and singular shift label for a one-shift group', () => {
  render(
    <OrdinaryGroups
      rows={[reviewEntry(1, 1)]}
      groupBy="person"
      selected={new Set()}
      onSelect={vi.fn()}
      onApprove={vi.fn().mockResolvedValue(undefined)}
      disabled={false}
    />,
  )
  expect(screen.getByText('1 shift · Nov 10 · 8.0h')).toBeInTheDocument()
})

it('shows full overtime secondary copy without truncation or current-year noise', () => {
  render(
    <NeedsLookList
      rows={[
        reviewEntry(1, 1, {
          review_kind: 'needs_look',
          work_date: '2026-11-06',
          hours: 11.5,
          overtime_status: 'pending',
          pending_overtime_hours: 6,
          exceptions: [{ key: 'overtime', label: 'Overtime' }],
        }),
      ]}
      onReview={vi.fn()}
    />,
  )
  const meta = screen.getByText(/Fri, Nov 6 · 11.5h · 6.0h overtime waiting/)
  expect(meta).toHaveClass('whitespace-normal')
  expect(meta).not.toHaveClass('truncate')
})

it('groups exceptional shifts by person and Sun–Sat week, with totals, tiny-shift warning and two priority chips', () => {
  const onReview = vi.fn()
  const base = reviewEntry(1, 1, {
    review_kind: 'needs_look',
    overtime_status: 'pending',
    pending_overtime_hours: 8,
    exceptions: [
      { key: 'after_lock', label: 'After the lock' },
      { key: 'overtime', label: 'Overtime' },
      { key: 'edited', label: 'Edited by Ethan' },
    ],
  })
  render(
    <NeedsLookList
      rows={[
        base,
        {
          ...base,
          id: 2,
          work_date: '2026-11-11',
          pending_overtime_hours: 5.6,
          hours: 0,
          clock_out_at: '2026-11-09T22:00:30Z',
        },
        { ...base, id: 3, work_date: '2026-11-15', pending_overtime_hours: 0 },
      ]}
      onReview={onReview}
    />,
  )
  expect(screen.getByText(/2 shifts this week.*13.6h overtime waiting/)).toBeInTheDocument()
  expect(screen.getAllByText('Edited by Ethan')).toHaveLength(2)
  expect(screen.queryByText('After the lock')).not.toBeInTheDocument()
  expect(screen.getByText('Under 1 minute, probably a mis-tap')).toBeInTheDocument()
  expect(screen.getByText(/Overtime to review/)).toBeInTheDocument()
  expect(screen.getAllByRole('button', { name: /^Review Marcus/ })).toHaveLength(2)
  fireEvent.click(
    screen.getByRole('button', { name: 'Review Marcus Quinata, week of 2026-11-08' }),
  )
  expect(onReview).toHaveBeenCalledWith(base)
})
