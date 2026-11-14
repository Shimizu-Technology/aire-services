import type { PayrollBatchAdjustment, PayrollBatchExclusion, PayrollBatchPayload, PayrollCarryoverItem } from '../../lib/api'
import type { AttentionResponse, ClockAttentionItem, MissingCategoryAttentionItem } from '../../lib/api/attention'
import type { PayrollPeriodSummary } from '../../lib/api/payrollPeriod'
import { ADMIN_PATHS } from '../../lib/adminRoutes'
import { businessDateISO } from '../../lib/dateUtils'
import { payPeriodContaining, payPeriodIncludes, type PayPeriod } from '../../lib/payPeriods'
import { withPayrollPeriod } from '../../lib/payrollPeriods'
import { LIFECYCLE_LABELS, PAYROLL_WORDS, PERSON_TOTAL_LABELS, type LifecycleStatus } from '../../lib/payrollTerms'
import type { ChecklistStatus } from '../ui'
import { hoursLabel, monthDay, periodLabel, plural } from '../today/format'
import { missingCategoryHref, openClockHref } from '../today/links'

// What the pay period page shows, worked out from the API answers. Kept apart
// from the components so each rule can be tested on its own.

export interface ChecklistEntry {
  key: 'approvals' | 'open_clocks' | 'overtime' | 'missing_category' | 'late_hours'
  status: ChecklistStatus
  text: string
  meta?: string
  action?: { label: string; to: string }
}

/** Approvals for this period's dates. Both the inbox and the classic queue read these. */
export const approvalsForPeriodHref = (range: PayPeriod, extra: Record<string, string> = {}) =>
  withPayrollPeriod(ADMIN_PATHS.approvals, range, extra)

function names(people: string[], limit = 3) {
  const unique = [...new Set(people)]
  if (unique.length <= limit) return unique.join(', ')
  return `${unique.slice(0, limit).join(', ')} and ${unique.length - limit} more`
}

/**
 * What waits for approval on this period's dates, from
 * `GET /time_entries/pending_approvals` (the Approvals badge's scope).
 * `overtime.hours` is null when the overtime list was cut short, so the
 * page shows a count rather than a guess.
 */
export interface PeriodWaiting {
  count: number
  hours: number
  overtime: { count: number; hours: number | null; people: string[] }
}

function approvalsItem(range: PayPeriod, count: number, hours: number): ChecklistEntry {
  return count > 0
    ? { key: 'approvals', status: 'todo', text: `${plural(count, 'shift')} waiting for approval`, meta: hoursLabel(hours), action: { label: 'Review', to: approvalsForPeriodHref(range) } }
    : { key: 'approvals', status: 'done', text: 'No shifts waiting for approval' }
}

function openClocksItem(clocks: Array<{ name: string; to: string }>): ChecklistEntry {
  if (clocks.length === 0) return { key: 'open_clocks', status: 'done', text: 'Nobody is still clocked in from an earlier day' }
  const people = new Set(clocks.map(clock => clock.name)).size
  return {
    key: 'open_clocks',
    status: 'todo',
    text: `${plural(people, 'person', 'people')} still clocked in from an earlier day`,
    meta: names(clocks.map(clock => clock.name)),
    action: { label: 'Fix', to: clocks[0].to },
  }
}

function overtimeItem(range: PayPeriod, count: number, hours: number | null, people: string[]): ChecklistEntry {
  if (count === 0) return { key: 'overtime', status: 'done', text: 'No overtime waiting' }
  return {
    key: 'overtime',
    status: 'todo',
    text: hours === null ? `${plural(count, 'shift')} with overtime waiting` : `${hoursLabel(hours)} overtime waiting`,
    meta: names(people) || undefined,
    action: { label: 'Review', to: approvalsForPeriodHref(range, { approval_type: 'overtime' }) },
  }
}

function missingCategoryItem(count: number, to: string): ChecklistEntry {
  return count > 0
    ? { key: 'missing_category', status: 'todo', text: `${plural(count, 'shift')} ${count === 1 ? 'has' : 'have'} no work category`, action: { label: 'Fix', to } }
    : { key: 'missing_category', status: 'done', text: 'Every shift has a work category' }
}

function lateHoursItem(preview: PayrollBatchPayload, previousStart: string | null): ChecklistEntry {
  const lines = preview.employees.flatMap(employee => employee.adjustments).filter(line => line.source_kind === 'carryover')
  const previous = previousStart ? payPeriodContaining(previousStart) : null
  const fromPrevious = previous && lines.every(line => payPeriodIncludes(previous, line.original_work_date))
  const source = fromPrevious ? `the ${periodLabel({ start_date: previous.start, end_date: previous.end })} lock` : 'an earlier lock'
  if (lines.length === 0) {
    return {
      key: 'late_hours',
      status: 'done',
      text: previous ? `No late hours from ${periodLabel({ start_date: previous.start, end_date: previous.end })} to carry in` : 'No late hours to carry in',
    }
  }
  const shifts = new Set(lines.map(line => line.source_time_entry_id)).size
  return {
    key: 'late_hours',
    status: 'info',
    text: `${plural(shifts, 'shift')} approved after ${source} ${shifts === 1 ? 'goes' : 'go'} into this payroll`,
    meta: hoursLabel(lines.reduce((sum, line) => sum + line.total_hours, 0)),
  }
}

export interface ChecklistInput {
  range: PayPeriod
  /** Today in Guam (YYYY-MM-DD): an open clock from before today is a likely missed clock-out. */
  today: string
  /** Today's attention list. Used only when it describes this period. */
  attention: AttentionResponse | null
  /** What goes to payroll if it locked now: blocking category issues (carried-in work too) and late hours. */
  preview: PayrollBatchPayload | null
  /** Shifts and overtime waiting on this period's dates. */
  waiting: PeriodWaiting | null
  /** The period before this one, for the late-hours line. */
  previousStart: string | null
}

const timecardHref = (entryId: string, query: Record<string, string> = {}) =>
  `${ADMIN_PATHS.timecards}?${new URLSearchParams({ entry_id: entryId, ...query })}`

/**
 * The Before it locks lines, in the spec's order. Each line comes from the
 * source that scopes it to this period; a line whose source hasn't loaded is
 * left out rather than shown as done.
 * - Waiting shifts and overtime: pending approvals for the period's dates.
 * - Earlier-day clocks: Today's attention list for the current period, else
 *   the preview's open clocks from before today.
 * - Work categories: the preview's blocking count (what stops the lock,
 *   carried-in work included), else Today's.
 */
export function checklistEntries({ range, today, attention, preview, waiting, previousStart }: ChecklistInput): ChecklistEntry[] {
  const forThisPeriod = attention?.period?.start_date === range.start ? attention : null
  const items: ChecklistEntry[] = []

  if (waiting) items.push(approvalsItem(range, waiting.count, waiting.hours))

  if (forThisPeriod) {
    const clocks = forThisPeriod.items
      .filter((item): item is ClockAttentionItem => item.type === 'open_clock_earlier_day' && payPeriodIncludes(range, item.work_date))
      .map(item => ({ name: item.user.full_name || item.user.display_name, to: openClockHref(item) }))
    items.push(openClocksItem(clocks))
  } else if (preview) {
    const clocks = preview.exclusions
      .filter(item => item.reason === 'open_clock' && item.original_work_date < today)
      .map(item => ({ name: item.display_name, to: timecardHref(item.source_time_entry_id, { date: item.original_work_date, user_id: item.source_user_id }) }))
    items.push(openClocksItem(clocks))
  }

  if (waiting) items.push(overtimeItem(range, waiting.overtime.count, waiting.overtime.hours, waiting.overtime.people))

  if (preview) {
    const blocking = preview.employees.flatMap(employee => employee.adjustments).find(line => !line.category)
    const fallback = forThisPeriod?.items.find((item): item is MissingCategoryAttentionItem => item.type === 'missing_category')
    const to = blocking ? timecardHref(blocking.source_time_entry_id) : missingCategoryHref(fallback?.entry_ids[0])
    items.push(missingCategoryItem(preview.issues.missing_category_count, to))
  } else if (forThisPeriod) {
    const missing = forThisPeriod.items.find((item): item is MissingCategoryAttentionItem => item.type === 'missing_category')
    items.push(missingCategoryItem(missing?.count ?? 0, missingCategoryHref(missing?.entry_ids[0])))
  }

  if (preview) items.push(lateHoursItem(preview, previousStart))
  return items
}

/** Held-back reasons that clear once someone acts before the lock. */
const WAITING_REASONS = new Set(['pending_approval', 'pending_overtime', 'open_clock'])

export interface PersonRow {
  id: string
  name: string
  regular: number
  overtime: number
  waiting: number
  stillClockedIn: boolean
  overtimeWaiting: number
  /** The part of `overtimeWaiting` from shifts dated before this period (carried in). */
  overtimeWaitingEarlier: number
  missingCategory: boolean
  lines: PayrollBatchAdjustment[]
  held: PayrollBatchExclusion[]
}

/** One row per person: what goes to payroll and what is still waiting. People with only waiting time are listed too. */
export function personRows(payload: PayrollBatchPayload): PersonRow[] {
  const rows = new Map<string, PersonRow>()
  const row = (id: string, name: string) => {
    let current = rows.get(id)
    if (!current) {
      current = { id, name, regular: 0, overtime: 0, waiting: 0, stillClockedIn: false, overtimeWaiting: 0, overtimeWaitingEarlier: 0, missingCategory: false, lines: [], held: [] }
      rows.set(id, current)
    }
    return current
  }
  for (const employee of payload.employees) {
    const current = row(employee.source_user_id, employee.display_name)
    current.regular += employee.regular_hours
    current.overtime += employee.overtime_hours
    current.lines.push(...employee.adjustments)
    current.missingCategory ||= employee.adjustments.some(line => !line.category)
  }
  for (const item of payload.exclusions) {
    const current = row(item.source_user_id, item.display_name)
    current.held.push(item)
    if (WAITING_REASONS.has(item.reason)) current.waiting += item.held_total_hours
    if (item.reason === 'open_clock') current.stillClockedIn = true
    if (item.reason === 'pending_overtime') {
      current.overtimeWaiting += item.held_overtime_hours
      if (item.original_work_date < payload.start_date) current.overtimeWaitingEarlier += item.held_overtime_hours
    }
  }
  return [...rows.values()].sort((a, b) => a.name.localeCompare(b.name))
}

export const periodHref = (startDate: string) => `/admin/payroll/periods/${startDate}`

const day = (instant: string) => monthDay(businessDateISO(new Date(instant)))

/** "Locked Nov 2 · paid Nov 10 · 30 people · 1,962.4h". */
export function periodFacts(period: PayrollPeriodSummary) {
  const hours = period.hours_source === 'locked' ? period.locked_hours : period.approved_hours
  return [
    period.locked_at ? `Locked ${day(period.locked_at)}` : null,
    period.handoff_state === 'paid' && period.payroll_status?.occurred_at ? `paid ${day(period.payroll_status.occurred_at)}` : null,
    plural(period.people, 'person', 'people'),
    hours === undefined ? null : hoursLabel(hours),
  ].filter(Boolean).join(' · ')
}

/** The carried part of a shift (held overtime, say), and the whole shift when that's bigger. */
export function carriedHours(item: PayrollCarryoverItem): { carried: number; shift: number | null } {
  const shift = item.current_total_hours
  return { carried: item.held_total_hours, shift: shift !== null && shift > item.held_total_hours ? shift : null }
}

/**
 * Where a carried shift went, in the glossary's words. Paid and accounting
 * outcomes count only once the backend verified them (`completion`); a
 * reported payment it couldn't match yet is a payment follow-up, as on the
 * records page.
 */
export function carriedDestination(item: PayrollCarryoverItem): { label: string; to?: string } {
  if (item.included_batch) {
    return { label: `In the ${periodLabel(item.included_batch)} payroll`, to: periodHref(item.included_batch.start_date) }
  }
  if (item.completion === 'paid') return { label: LIFECYCLE_LABELS.payment_issued }
  if (item.completion === 'accounting_recorded') return { label: PERSON_TOTAL_LABELS.correction }
  const accounting = item.payroll_lifecycle?.accounting_only === true && item.payroll_lifecycle.status === 'committed'
  if (item.status === 'payment_issued' || accounting) return { label: PAYROLL_WORDS.paymentFollowUp }
  if (item.status === 'ready_for_next_batch') return { label: 'Next payroll' }
  if (item.status === 'not_payable') return { label: PAYROLL_WORDS.closedWithoutPay }
  if (Object.hasOwn(LIFECYCLE_LABELS, item.status)) return { label: LIFECYCLE_LABELS[item.status as LifecycleStatus] }
  return { label: PAYROLL_WORDS.paymentFollowUp }
}
