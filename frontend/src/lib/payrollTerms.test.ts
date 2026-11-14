import { describe, expect, it } from 'vitest'
import { HANDOFF_STATE_LABELS, PERSON_TOTAL_LABELS, isLockedState, showsNotMatched, type HandoffState } from './payrollTerms'

describe('payroll terms', () => {
  it('has a plain label for every hand-off state and person total', () => {
    expect(HANDOFF_STATE_LABELS).toMatchInlineSnapshot(`
      {
        "before_locking": "Before locking",
        "in_run": "In a payroll run",
        "locked": "Locked for payroll",
        "open": "Open",
        "paid": "Paid",
        "received": "Received by Payroll",
      }
    `)
    expect(Object.values(PERSON_TOTAL_LABELS).every((label) => label.length > 0 && !/reconciliation|eligible|issued|committed|evidence/i.test(label))).toBe(true)
    expect(PERSON_TOTAL_LABELS.notMatched).toBe('Not matched to a paycheck yet')
  })

  it.each<[HandoffState | null, string | null, boolean]>([
    ['open', 'scheduled', false],
    ['locked', 'finalized', true],
    ['received', 'finalized', true],
    ['in_run', 'finalized', true],
    ['paid', 'finalized', true],
    ['before_locking', 'open', false],
    ['before_locking', 'finalized', true],
    [null, null, false],
  ])('treats %s (%s) as locked: %s', (state, status, locked) => {
    expect(isLockedState(state, status)).toBe(locked)
  })

  it('shows not-matched hours only on a locked period after payday', () => {
    const today = '2026-11-14'
    expect(showsNotMatched({ state: 'open', payDate: '2026-11-10', today })).toBe(false)
    expect(showsNotMatched({ state: 'locked', payDate: '2026-11-25', today })).toBe(false)
    expect(showsNotMatched({ state: 'locked', payDate: '2026-11-14', today })).toBe(false)
    expect(showsNotMatched({ state: 'paid', payDate: '2026-11-10', today })).toBe(true)
    expect(showsNotMatched({ state: 'in_run', payDate: null, today })).toBe(false)
    expect(showsNotMatched({ state: null, payDate: '2026-10-01', today })).toBe(false)
  })
})
