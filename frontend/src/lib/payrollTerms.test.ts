/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { PayrollEntryLifecycleStatus } from './api'
import {
  HANDOFF_STATE_LABELS,
  LIFECYCLE_LABELS,
  PAYROLL_WORDS,
  PERSON_TOTAL_LABELS,
  UNCONFIRMED_TERMS,
  isLockedState,
  lifecycleLabel,
  showsNotMatched,
  type HandoffState,
  type LifecycleStatus,
} from './payrollTerms'

// The backend copies of the words, read from disk: Vite won't import outside
// frontend/. Vitest runs from frontend/.
const backend = (file: string) => readFileSync(`${process.cwd()}/../backend/app/services/payroll/${file}`, 'utf8')
const resolverSource = backend('entry_lifecycle_resolver.rb')
const handoffSource = backend('period_handoff_state.rb')

/** `"key" => "Label"` pairs from a Ruby `NAME = { ... }.freeze` hash. */
function rubyHash(source: string, name: string) {
  const block = new RegExp(`${name} = \\{\\n([\\s\\S]*?)\\n\\s*\\}\\.freeze`).exec(source)?.[1]
  if (!block) throw new Error(`${name} not found`)
  return Object.fromEntries(block.split('\n').filter(line => line.trim()).map(line => {
    const match = /^\s*"(\w+)" => "([^"]*)",?\s*$/.exec(line)
    if (!match) throw new Error(`Unreadable line: ${line}`)
    return [match[1], match[2]]
  }))
}

// Every status the API can send, checked at compile time against lib/api.ts.
const API_STATUSES: Record<PayrollEntryLifecycleStatus, true> = {
  awaiting_approval: true, not_payable: true, ready_for_cutoff: true, finalized: true, imported: true, committed: true,
  payment_prepared: true, payment_issued: true, payment_failed: true, payment_cancelled: true, payment_voided: true,
  partially_paid: true, partially_prepared: true, partially_processed: true, partially_allocated: true,
  payment_attested_pending_evidence: true,
}

describe('payroll glossary', () => {
  it('has a plain label for every lifecycle status', () => {
    expect(Object.keys(LIFECYCLE_LABELS).sort()).toEqual(Object.keys(API_STATUSES).sort())
    expect(LIFECYCLE_LABELS).toMatchInlineSnapshot(`
      {
        "awaiting_approval": "Waiting for approval",
        "committed": "In a payroll run",
        "finalized": "Locked for payroll",
        "imported": "Received by Payroll",
        "not_payable": "Denied, won't be paid",
        "partially_allocated": "Partly in payroll",
        "partially_paid": "Partly paid",
        "partially_prepared": "Partly in payroll",
        "partially_processed": "Partly in payroll",
        "payment_attested_pending_evidence": "Paid outside payroll, details pending",
        "payment_cancelled": "Payment cancelled",
        "payment_failed": "Payment problem",
        "payment_issued": "Paid",
        "payment_prepared": "Check prepared",
        "payment_voided": "Payment voided",
        "ready_for_cutoff": "Approved, not locked yet",
      }
    `)
  })

  it('uses the same words as the backend', () => {
    expect(rubyHash(resolverSource, 'LABELS')).toEqual(LIFECYCLE_LABELS)
    expect(rubyHash(handoffSource, 'LABELS')).toEqual(HANDOFF_STATE_LABELS)
    expect(resolverSource).toContain(`MANUAL_PAYROLL_LABEL = "${PAYROLL_WORDS.manualPayroll}"`)
  })

  it('keeps internal payroll terms out of every label', () => {
    const labels = [...Object.values(LIFECYCLE_LABELS), ...Object.values(HANDOFF_STATE_LABELS), ...Object.values(PAYROLL_WORDS)]
    expect(labels.filter(label => /cutoff|eligible|imported|committed|evidence|reconciliation|carryover|Partially/i.test(label))).toEqual([])
  })

  it('lists the words Chels still has to confirm, each in use', () => {
    const used = [...Object.values(LIFECYCLE_LABELS), ...Object.values(HANDOFF_STATE_LABELS), ...Object.values(PERSON_TOTAL_LABELS), ...Object.values(PAYROLL_WORDS)]
    for (const term of UNCONFIRMED_TERMS) expect(used.some(label => label.includes(term))).toBe(true)
  })

  it.each<[{ status: string; label?: string }, string]>([
    [{ status: 'committed', label: 'Payroll committed' }, 'In a payroll run'],
    [{ status: 'payment_attested_pending_evidence', label: 'Payment reported; check evidence pending' }, 'Paid outside payroll, details pending'],
    [{ status: 'brand_new_status', label: 'Something newer' }, 'Something newer'],
    [{ status: 'brand_new_status' }, 'brand_new_status'],
  ])('labels %j as %s', (lifecycle, label) => {
    expect(lifecycleLabel(lifecycle)).toBe(label)
  })

  it('types each lifecycle key', () => {
    const key: LifecycleStatus = 'partially_allocated'
    expect(LIFECYCLE_LABELS[key]).toBe('Partly in payroll')
  })
})

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
