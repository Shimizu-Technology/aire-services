import type { PendingApprovalsParams } from './api'
import type { ReviewEntry, ReviewItem } from './api/approvals'
import { parsePayPeriodStart } from './payPeriods'

export function pendingParams(query: URLSearchParams, department: string): PendingApprovalsParams {
  const params: Record<string, string | number> = {
    per_page: 500,
    sort: 'work_date',
    direction: 'asc',
  }
  const period = parsePayPeriodStart(query.get('period'))
  if (period) {
    params.start_date = period.start
    params.end_date = period.end
  }
  for (const key of [
    'date',
    'start_date',
    'end_date',
    'through_date',
    'since_date',
    'user_id',
    'time_category_id',
    'approval_type',
    'entry_method',
    'clock_source',
    'sort',
    'direction',
  ]) {
    const value = query.get(key)
    if (value) params[key] = value
  }
  if (department !== 'all') params.approval_group = department
  return params as PendingApprovalsParams
}
export function rememberedDepartment(userId: number | undefined) {
  try {
    return localStorage.getItem(`aire.approvals.department.${userId ?? 'viewer'}`) || 'all'
  } catch {
    return 'all'
  }
}
export function rememberDepartment(userId: number | undefined, value: string) {
  try {
    localStorage.setItem(`aire.approvals.department.${userId ?? 'viewer'}`, value)
  } catch {
    /* Storage may be unavailable in private browsing. */
  }
}
export function isOrdinary(entry: ReviewEntry) {
  return (
    entry.review_kind === 'ordinary' &&
    entry.exceptions.length === 0 &&
    entry.approval_status === 'pending' &&
    (entry.overtime_status === 'none' || entry.overtime_status === null) &&
    !entry.needs_another_approver &&
    Number.isInteger(entry.version)
  )
}
export interface ApprovalSelection {
  rows: readonly ReviewEntry[]
  items: readonly ReviewItem[]
  people: { id: number; name: string; count: number }[]
  hours: number
  dates: string[]
}
/** One immutable snapshot is used for both the confirmation and the request. */
export function approvalSelection(rows: readonly ReviewEntry[]): ApprovalSelection {
  if (
    !rows.length ||
    !rows.every(isOrdinary) ||
    new Set(rows.map(row => row.id)).size !== rows.length
  )
    throw new Error('Choose ordinary shifts from the current list.')
  const people = new Map<number, { id: number; name: string; count: number }>()
  for (const row of rows) {
    const person = people.get(row.user.id) ?? {
      id: row.user.id,
      name: row.user.full_name,
      count: 0,
    }
    person.count++
    people.set(person.id, person)
  }
  return {
    rows: [...rows],
    items: rows.map(row => ({
      id: row.id,
      version: row.version,
      approve_time: true,
      approve_overtime: false,
    })),
    people: [...people.values()],
    hours: rows.reduce((sum, row) => sum + row.hours, 0),
    dates: rows.map(row => row.work_date).sort(),
  }
}
export function exclusionCopy(rows: ReviewEntry[]) {
  const people = new Map<string, ReviewEntry[]>()
  for (const row of rows)
    people.set(row.user.full_name, [...(people.get(row.user.full_name) ?? []), row])
  return [...people]
    .map(([name, entries]) => {
      const reasons = [
        ...new Set(entries.flatMap(entry => entry.exceptions.map(reason => reason.label))),
      ]
      const overtime = entries
        .filter(entry => entry.overtime_status === 'pending')
        .reduce((sum, entry) => sum + (entry.pending_overtime_hours ?? 0), 0)
      return `${name}: ${entries.length} ${entries.length === 1 ? 'shift' : 'shifts'} · ${reasons.join(', ')}${overtime > 0 ? ` · ${overtime.toFixed(1)}h overtime waiting` : ''}`
    })
    .join('; ')
}
