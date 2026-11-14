import { render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { approvalSelection } from '../../lib/approvalsFilters'
import { reviewEntry } from '../../test/approvalFixtures'
import ApproveAllDialog from './ApproveAllDialog'
it.each([
  'Wait for approvals to finish loading',
  'Reload approvals before saving',
  'Reconnect to approve',
])('disables confirmation with the full reason: %s', reason => {
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
  expect(screen.getByRole('button', { name: 'Approve 1 shift' })).toHaveAttribute('title', reason)
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled()
})
