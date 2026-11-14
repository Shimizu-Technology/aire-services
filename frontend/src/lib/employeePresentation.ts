import type { TimeEntry } from './api'
import { formatDateOnly } from './dateUtils'
import { todayInGuam } from './payPeriods'
import type { StatusTone } from '../components/ui/StatusPill'

/** One employee status, with approval as the fallback when payroll is unknown. */
export function employeeShiftStatus(entry: TimeEntry): {
  label: string
  tone: StatusTone
} {
  if (entry.status !== 'completed') return { label: 'Shift in progress', tone: 'info' }
  if (entry.approval_status === 'denied') {
    return { label: 'Not in payroll — time denied', tone: 'needs-fix' }
  }
  const payroll = entry.payroll_status
  const unknown =
    !payroll ||
    payroll.status === 'payment_history_unavailable' ||
    /not tracked/i.test(payroll.label)
  if (unknown || payroll.status === 'awaiting_approval') {
    return entry.approval_status === 'approved'
      ? { label: 'Approved — not paid yet', tone: 'approved' }
      : { label: 'Waiting for approval', tone: 'waiting' }
  }
  return {
    label: payroll.label,
    tone: ['payment_failed', 'payment_voided', 'payment_cancelled'].includes(
      payroll.status,
    )
      ? 'needs-fix'
      : payroll.status === 'held'
        ? 'waiting'
        : 'approved',
  }
}

export function employeeDate(
  date: string,
  options: Intl.DateTimeFormatOptions = {},
  today = todayInGuam(),
) {
  return formatDateOnly(date, {
    month: 'short',
    day: 'numeric',
    ...options,
    ...(date.slice(0, 4) !== today.slice(0, 4) ? { year: 'numeric' } : {}),
  })
}

export function employeeDateRange(start: string, end: string, today = todayInGuam()) {
  if (start === end) return employeeDate(start, {}, today)
  if (start.slice(0, 7) === end.slice(0, 7)) {
    const month = formatDateOnly(start, { month: 'short' })
    const year = start.slice(0, 4) === today.slice(0, 4) ? '' : `, ${start.slice(0, 4)}`
    return `${month} ${Number(start.slice(8))}–${Number(end.slice(8))}${year}`
  }
  return `${employeeDate(start, {}, today)}–${employeeDate(end, {}, today)}`
}
