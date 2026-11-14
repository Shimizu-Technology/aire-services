import { render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { shift } from '../../test/employeeFixtures'
import { ShiftSheet } from './ShiftSheet'

it.each([
  ['approved', 'Approved by Mindy'],
  ['denied', 'Declined by Mindy'],
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
      approval === 'denied' ? 'Approved by Mindy' : 'Declined by Mindy',
    ),
  ).not.toBeInTheDocument()
})
