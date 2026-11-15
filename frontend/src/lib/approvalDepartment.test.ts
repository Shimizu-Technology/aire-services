import { expect, it } from 'vitest'
import { approvalDepartment } from './approvalDepartment'

it('shares membership-first defaults, legacy fallback, unassigned and administrator scopes', () => {
  expect(
    approvalDepartment({ approval_group_keys: ['cfi', 'ops'], approval_group: 'ops' }),
  ).toBe('cfi')
  expect(approvalDepartment({ approval_group: 'ops' })).toBe('ops')
  expect(approvalDepartment({ approval_group_keys: [], approval_group: null })).toBe(
    'unassigned',
  )
  expect(approvalDepartment({ approval_group_keys: ['cfi'] }, true)).toBe('all')
})
