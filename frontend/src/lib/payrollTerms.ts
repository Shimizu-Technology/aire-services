// The plain payroll words from the glossary draft (DESIGN.md §5). Chels hasn't
// confirmed them yet, so every payroll label the person page shows lives here
// and changes in one line. The backend's PeriodHandoffState::LABELS holds the
// same words for the pay period states.
export const PAYROLL_TERMS_PROVISIONAL = true

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
