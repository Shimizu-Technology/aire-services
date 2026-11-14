import { render, screen } from '@testing-library/react'
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
  const meta = screen.getByText(/Fri, Nov 6 · 11.5h · 6.0h overtime this week/)
  expect(meta).toHaveClass('whitespace-normal')
  expect(meta).not.toHaveClass('truncate')
})
