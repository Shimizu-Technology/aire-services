import type { PayrollCutoffResponse } from '../../lib/api'
import { formatPayPeriod } from '../../lib/payPeriods'
import { lockStatus, lockTimeLabel } from '../today/format'

/** The reminder can retain a finalized period; only describe an active lock. */
export function approvalLockCopy(response: PayrollCutoffResponse | null, now = new Date()) {
  const fallback = {
    description: '',
    confirmation: "They'll go to payroll at the next lock.",
  }
  if (!response) return fallback
  const { cutoff, lock_control: control } = response
  const period = control?.period ?? cutoff.period
  const at = control?.cutoff_at ?? cutoff.cutoff_at
  if (!period || !at || !Number.isFinite(Date.parse(at))) return fallback

  if (control) {
    if (control.status !== 'scheduled') return fallback
  } else if (cutoff.stage !== 'finalizing' && Date.parse(at) <= now.getTime()) {
    return fallback
  }

  const status = lockStatus({
    period: null,
    control: control ?? null,
    cutoffAt: at,
    now,
    paused: response.connected_payroll?.enabled === false,
  })
  const label = formatPayPeriod({ start: period.start_date, end: period.end_date })
  if (status.kind === 'due' || status.kind === 'requested') {
    return {
      description: ` · ${label} · ${status.label}`,
      confirmation: "They'll go to payroll at the lock now in progress.",
    }
  }
  if (status.kind !== 'upcoming') return fallback
  return {
    description: ` · ${label} locks ${lockTimeLabel(at)}`,
    confirmation: `They'll go to payroll at the ${lockTimeLabel(at)} lock.`,
  }
}
