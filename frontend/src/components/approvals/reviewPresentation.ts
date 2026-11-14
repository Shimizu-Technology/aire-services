export { isTinyShift } from '../../lib/approvalsFilters'
import type { ReviewEntry } from '../../lib/api/approvals'
import { formatApprovalDate } from '../../lib/approvalsDates'

export const reviewStatus = (status: string | null | undefined) =>
  status === 'pending'
    ? 'Waiting'
    : status === 'denied'
      ? 'Denied'
      : status === 'approved'
        ? 'Approved'
        : 'Standard'

/** Remove known machine annotations; keep a person's note, including denial reasons. */
export function personNote(note: string | null | undefined) {
  return (note ?? '')
    .replace(/Clocked in without a schedule/gi, '')
    .replace(/Employee edited (?:time )?entry(?:\s*[—–-]\s*awaiting admin review)?/gi, '')
    .split('|')
    .map((part) => part.trim())
    .filter(Boolean)
    .join(' · ')
}

export function leaveType(type: string) {
  const words = type.replaceAll('_', ' ')
  return words[0].toUpperCase() + words.slice(1)
}

export function leaveDateRange(start: string, end: string) {
  return start === end
    ? formatApprovalDate(start)
    : `${formatApprovalDate(start)}–${formatApprovalDate(end)}`
}

/** Safety/policy first, then actual changes, then payroll context. */
export function reasonChips(entries: ReviewEntry[]) {
  const priority = [
    'needs_another_approver',
    'administrator_correction',
    'edited',
    'corrected_clock_out',
    'added',
    'overtime',
    'own_time',
    'supervisor_own_time',
  ]
  const unique = new Map(
    entries.flatMap((entry) => entry.exceptions).map((reason) => [reason.key, reason]),
  )
  return [...unique.values()]
    .sort((a, b) => {
      const rank = (key: string) =>
        priority.includes(key) ? priority.indexOf(key) : priority.length
      return rank(a.key) - rank(b.key)
    })
    .slice(0, 2)
}
