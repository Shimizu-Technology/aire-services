// The plain payroll words from the glossary draft (DESIGN.md §5). Chels hasn't
// confirmed them yet, so every payroll label lives here and changes in one
// line. The backend holds the same words in PeriodHandoffState::LABELS (pay
// period states) and EntryLifecycleResolver::LABELS (shift lifecycle);
// payrollGlossary.test.ts fails if the two sides disagree.
export const PAYROLL_TERMS_PROVISIONAL = true

/** The glossary words Chels still has to confirm (DESIGN.md §5 questions). */
export const UNCONFIRMED_TERMS = ['In a payroll run', 'Received by Payroll', 'On hold', 'Payroll done outside the connection'] as const

/** Where a published pay period is in the hand-off to Cornerstone Payroll. */
export type HandoffState = 'open' | 'locked' | 'received' | 'in_run' | 'paid' | 'before_locking'

export const HANDOFF_STATE_LABELS: Record<HandoffState, string> = {
  open: 'Open',
  locked: 'Locked for payroll',
  received: 'Received by Payroll',
  in_run: 'In a payroll run',
  paid: 'Paid',
  before_locking: 'Before locking',
}

/** States after AIRE locked the hours; "before locking" counts only once its period was finalized. */
const LOCKED_STATES: HandoffState[] = ['locked', 'received', 'in_run', 'paid']

export function isLockedState(state: HandoffState | null | undefined, status?: string | null) {
  if (!state) return false
  return LOCKED_STATES.includes(state) || (state === 'before_locking' && status === 'finalized')
}

/** A person's hours in a pay period, by where they are in payroll. */
export type PersonTotal =
  | 'worked'
  | 'approved'
  | 'waiting'
  | 'overtimeWaiting'
  | 'denied'
  | 'paid'
  | 'inRun'
  | 'sent'
  | 'onHold'
  | 'notMatched'
  | 'correction'

export const PERSON_TOTAL_LABELS: Record<PersonTotal, string> = {
  worked: 'Worked',
  approved: 'Approved',
  waiting: 'Waiting for approval',
  overtimeWaiting: 'Overtime waiting',
  denied: "Denied, won't be paid",
  paid: 'Paid (confirmed by Payroll)',
  inRun: 'In a payroll run, not paid yet',
  sent: 'Sent to Payroll, not in a run yet',
  onHold: 'On hold',
  notMatched: 'Not matched to a paycheck yet',
  correction: 'Correction to an earlier payroll',
}

export const PERSON_TOTAL_HELP: Partial<Record<PersonTotal, string>> = {
  worked: 'All clocked and added time.',
  approved: 'Approved for pay. Overtime that still waits for approval is counted separately.',
  paid: 'Hours Payroll says were paid.',
  onHold: 'Held back from payroll until someone resolves it.',
  notMatched: "Approved hours we can't yet match to a paycheck. Before payday this is normal and hidden.",
}

/**
 * Not-matched hours mean something only after payday on a locked period.
 * Before that they're every approved hour, so they stay hidden.
 */
export function showsNotMatched(input: { state: HandoffState | null | undefined; status?: string | null; payDate?: string | null; today: string }) {
  return isLockedState(input.state, input.status) && Boolean(input.payDate) && input.payDate! < input.today
}

/** Where one shift is in payroll (`payroll_lifecycle.status`). Keep one entry per line: the backend spec reads them. */
export type LifecycleStatus =
  | 'awaiting_approval'
  | 'not_payable'
  | 'ready_for_cutoff'
  | 'finalized'
  | 'imported'
  | 'committed'
  | 'payment_prepared'
  | 'payment_issued'
  | 'payment_failed'
  | 'payment_cancelled'
  | 'payment_voided'
  | 'partially_paid'
  | 'partially_prepared'
  | 'partially_processed'
  | 'partially_allocated'
  | 'payment_attested_pending_evidence'

export const LIFECYCLE_LABELS: Record<LifecycleStatus, string> = {
  awaiting_approval: 'Waiting for approval',
  not_payable: "Denied, won't be paid",
  ready_for_cutoff: 'Approved, not locked yet',
  finalized: 'Locked for payroll',
  imported: 'Received by Payroll',
  committed: 'In a payroll run',
  payment_prepared: 'Check prepared',
  payment_issued: 'Paid',
  payment_failed: 'Payment problem',
  payment_cancelled: 'Payment cancelled',
  payment_voided: 'Payment voided',
  partially_paid: 'Partly paid',
  partially_prepared: 'Partly in payroll',
  partially_processed: 'Partly in payroll',
  partially_allocated: 'Partly in payroll',
  payment_attested_pending_evidence: 'Paid outside payroll, details pending',
}

export const LIFECYCLE_HELP: Record<LifecycleStatus, string> = {
  awaiting_approval: "A manager or admin hasn't approved this time yet.",
  not_payable: "Someone denied it. It won't go to payroll unless it's reopened.",
  ready_for_cutoff: 'Approved. It goes to payroll at the next lock.',
  finalized: 'AIRE froze it at the lock and is sending it to Cornerstone Payroll.',
  imported: 'Cornerstone Payroll has it.',
  committed: "Part of a payroll run in Cornerstone Payroll, not paid yet.",
  payment_prepared: 'The check or deposit is prepared but not issued.',
  payment_issued: 'Paid.',
  payment_failed: 'Payroll reported a problem paying this. Follow up in Cornerstone Payroll.',
  payment_cancelled: 'The payment was cancelled. The hours are still in the payroll run.',
  payment_voided: 'The payment was voided in Payroll.',
  partially_paid: "Some hours of this shift are paid, the rest aren't yet.",
  partially_prepared: 'Some hours of this shift have a check prepared, the rest are still in payroll.',
  partially_processed: 'Some hours of this shift are at a different payroll step than the rest.',
  partially_allocated: 'Some hours of this shift are already in a payroll run, the rest are not.',
  payment_attested_pending_evidence: "An owner said it was paid (for example, a manual check). The check details aren't recorded yet.",
}

/** "Waiting for approval" for a known status; the server's label for a status this version doesn't know yet. */
export function lifecycleLabel(lifecycle: { status: string; label?: string | null }) {
  return Object.hasOwn(LIFECYCLE_LABELS, lifecycle.status)
    ? LIFECYCLE_LABELS[lifecycle.status as LifecycleStatus]
    : lifecycle.label || lifecycle.status
}

/** Words the pay period page uses for payroll events. */
export const PAYROLL_WORDS = {
  payPeriod: 'Pay period',
  carriedHours: 'Hours carried to a later period',
  carriedHoursHelp: 'Hours approved after a lock. They go into the next payroll.',
  lateHours: 'Late hours (added to the next payroll)',
  lock: 'Lock',
  manualPayroll: 'Payroll done outside the connection',
  manualPayrollHelp: 'A payroll run without the AIRE connection, recorded so the hours count as paid.',
  paymentFollowUp: 'Payment follow-up',
  closedWithoutPay: 'Closed without pay',
} as const
