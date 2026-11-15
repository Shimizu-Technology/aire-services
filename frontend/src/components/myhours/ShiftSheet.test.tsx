import { render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { shift } from '../../test/employeeFixtures'
import { ShiftSheet } from './ShiftSheet'

it.each([
  ['approved', 'Approved by Mindy'],
  ['denied', 'Denied by Mindy'],
] as const)('labels the %s review actor correctly', (approval, label) => {
  const entry = shift({
    approval_status: approval,
    approved_by: { id: 4, full_name: 'Mindy' },
  })
  render(
    <ShiftSheet
      entry={entry}
      weekEntries={[entry]}
      weekUnavailable={false}
      onClose={vi.fn()}
      onFix={vi.fn()}
    />,
  )
  expect(screen.getByText(label)).toBeInTheDocument()
  expect(
    screen.queryByText(
      approval === 'denied' ? 'Approved by Mindy' : 'Denied by Mindy',
    ),
  ).not.toBeInTheDocument()
})

it('hides system approval notes without a human review actor', () => {
  const entry = shift({ approval_note: 'Clocked in without a schedule', approved_by: null })
  render(<ShiftSheet entry={entry} weekEntries={[entry]} weekUnavailable={false} onClose={vi.fn()} onFix={vi.fn()} />)
  expect(screen.queryByText("Manager's note")).not.toBeInTheDocument()
  expect(screen.queryByText('Clocked in without a schedule')).not.toBeInTheDocument()
})

it('explains a rejected change with the restored time and manager reason', () => {
  const entry = shift({ formatted_start_time: '7:00 AM', formatted_end_time: '1:20 PM', rejected_employee_change: { manager: 'Roke', note: 'Original punches are correct', at: '2026-11-15T00:00:00Z' } })
  render(<ShiftSheet entry={entry} weekEntries={[entry]} weekUnavailable={false} onClose={vi.fn()} onFix={vi.fn()} />)
  expect(screen.getByRole('status')).toHaveTextContent("Your change wasn't approved. Your shift was kept at 7:00 AM–1:20 PM. Note from Roke: Original punches are correct")
})
