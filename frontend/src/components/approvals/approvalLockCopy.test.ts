import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { PayrollCutoffResponse } from '../../lib/api'
import { approvalLockCopy } from './approvalLockCopy'

const response = (at: string): PayrollCutoffResponse => ({
  cutoff: { stage: 'none', period: null, cutoff_at: null } as PayrollCutoffResponse['cutoff'],
  next_lock: { period: { id: 1, start_date: '2026-11-01', end_date: '2026-11-15' }, cutoff_at: at },
})
// Period labels drop the year only in the current year, so pin the clock to November 2026.
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-11-16T00:00:00Z')) })
afterEach(() => { vi.useRealTimers() })

it('uses the published next lock for managers in the header and confirmation', () => {
  const copy = approvalLockCopy(response('2026-11-22T17:00:00+10:00'), new Date('2026-11-16T00:00:00Z'))
  expect(copy.description).toContain('Nov 1–15 locks Sun, Nov 22, 5:00 PM')
  expect(copy.confirmation).toContain('Sun, Nov 22, 5:00 PM lock')
})
it('never presents a past next_lock as upcoming', () => {
  expect(approvalLockCopy(response('2026-11-15T17:00:00+10:00'), new Date('2026-11-16T00:00:00Z')).description).toBe('')
})
