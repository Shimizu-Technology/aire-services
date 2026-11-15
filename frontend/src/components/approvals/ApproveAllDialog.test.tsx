import { render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { approvalSelection } from '../../lib/approvalsFilters'
import { reviewEntry } from '../../test/approvalFixtures'
import ApproveAllDialog from './ApproveAllDialog'
afterEach(() => vi.useRealTimers())
it.each([
  'Wait for approvals to finish loading',
  'Reload approvals before saving',
  'Reconnect to approve',
])('disables confirmation with the full reason: %s', (reason) => {
  render(
    <ApproveAllDialog
      selection={approvalSelection([reviewEntry(1)])}
      exclusions=""
      busy={false}
      disabled
      disabledReason={reason}
      onConfirm={vi.fn()}
      onCancel={vi.fn()}
    />,
  )
  expect(screen.getByRole('button', { name: 'Approve 1 shift' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Approve 1 shift' })).toHaveAttribute(
    'title',
    reason,
  )
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled()
})

it('summarizes exclusions with a Show who disclosure, one date and a short undo note', () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-06T12:00:00Z'))
  render(
    <ApproveAllDialog
      selection={approvalSelection([reviewEntry(1)])}
      exclusions="Ethan Cruz: 7 shifts · Overtime; Grace Torres: 1 shift · Added by hand"
      excludedPeople={2}
      busy={false}
      onConfirm={vi.fn()}
      onCancel={vi.fn()}
    />,
  )
  expect(
    screen.getByText(/Not included: 2 people's shifts that need a look/),
  ).toBeInTheDocument()
  expect(screen.getByText('Show who').closest('details')).not.toHaveAttribute('open')
  expect(screen.getByText(/Ethan Cruz: 7 shifts/)).toBeInTheDocument()
  expect(screen.getByText(/1 person · Tue, Nov 10 · 8.0h/)).toBeInTheDocument()
  expect(screen.queryByText(/Nov 10.*Nov 10/)).not.toBeInTheDocument()
  expect(screen.getByText('You can undo for 15 minutes.')).toBeInTheDocument()
  expect(screen.queryByText(/Activity keeps/)).not.toBeInTheDocument()
})

it('pluralizes one additional person correctly', () => {
  render(
    <ApproveAllDialog
      selection={approvalSelection([1, 2, 3, 4].map((id) => reviewEntry(id)))}
      exclusions=""
      busy={false}
      onConfirm={vi.fn()}
      onCancel={vi.fn()}
    />,
  )
  expect(screen.getByText('+ 1 more person')).toBeInTheDocument()
})
