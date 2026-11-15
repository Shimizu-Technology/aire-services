import type { AuditLogEntry } from './api'

const TIME_ZONE = 'Pacific/Guam'

/** Recorded fields that read as "<label> from <old> to <new>". */
const VALUE_FIELDS: Record<string, string> = {
  start_time: 'clock-in',
  end_time: 'clock-out',
  work_date: 'work date',
  break_minutes: 'break',
  overtime_status: 'overtime approval',
  approval_status: 'approval',
}

/** Recorded fields whose values are ids or long text: say what changed, not the raw value. */
const VALUELESS_FIELDS: Record<string, string> = {
  time_category_id: 'the kind of work',
  description: 'the note',
  breaks: 'the detailed breaks',
}

/** Duplicates of start_time / end_time as full timestamps, hours handled on their own. */
const COVERED_FIELDS = new Set(['hours', 'clock_in_at', 'clock_out_at'])

const STATUS_WORDS: Record<string, string> = {
  pending: 'waiting',
  approved: 'approved',
  denied: 'denied',
  none: 'none',
}

function humanize(field: string) {
  return field.replaceAll('_', ' ').toLowerCase()
}

/** A number, or a numeric string such as "8.47" (Rails stores decimals as strings in snapshots). */
function asNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && /^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(value.trim())) return Number(value)
  return null
}

function isPair(value: unknown): value is [unknown, unknown] {
  return Array.isArray(value) && value.length === 2
}

function pairOf(value: unknown): { from: unknown; to: unknown } | null {
  if (isPair(value)) return { from: value[0], to: value[1] }
  if (value && typeof value === 'object' && 'from' in value && 'to' in value) {
    const { from, to } = value as { from: unknown; to: unknown }
    return { from, to }
  }
  return null
}

function isPrimitive(value: unknown): value is string | number | boolean | null | undefined {
  return value === null || value === undefined || ['string', 'number', 'boolean'].includes(typeof value)
}

export function formatDay(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return value
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(date)
}

function formatMinutes(value: number) {
  if (value === 0) return 'none'
  return `${value} minute${value === 1 ? '' : 's'}`
}

/** 8 becomes "8.0", 7.5 stays "7.5", 7.25 stays "7.25". */
export function formatHours(value: number) {
  const text = String(Math.round(value * 100) / 100)
  return text.includes('.') ? text : `${text}.0`
}

const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/

/** "5:00 PM" in Guam time. */
export function formatTimeOfDay(value: string) {
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: TIME_ZONE }).format(new Date(value))
}

function guamDay(value: string) {
  return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: TIME_ZONE }).format(new Date(value))
}

function formatValue(field: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return 'not set'
  if ((field === 'start_time' || field === 'end_time') && typeof value === 'string' && ISO_DATETIME.test(value)) return formatTimeOfDay(value)
  if (field === 'work_date' && typeof value === 'string') return formatDay(value)
  if (field === 'break_minutes' && asNumber(value) !== null) return formatMinutes(asNumber(value)!)
  if (field === 'hours' && asNumber(value) !== null) return formatHours(asNumber(value)!)
  if (field === 'overtime_status' || field === 'approval_status') return STATUS_WORDS[String(value)] ?? String(value)
  if (typeof value === 'boolean') return value ? 'yes' : 'no'
  return String(value)
}

function joinList(items: string[]) {
  if (items.length <= 1) return items[0] ?? ''
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

/** "Fri, Nov 14, 3:42 PM" in Guam time, for sentences that name when something happened. */
export function formatGuamTime(value: string) {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: TIME_ZONE,
  }).format(new Date(value))
}

export function actorName(event: Pick<AuditLogEntry, 'actor'>) {
  return event.actor.name || event.actor.email?.split('@')[0] || 'Someone'
}

type ChangeSummary = { items: string[]; hours: { from: string; to: string } | null | undefined }

function summarizeChanges(changes: Record<string, unknown>): ChangeSummary {
  const fields = Object.entries(changes)
  const hasTimes = fields.some(([field]) => field === 'start_time' || field === 'end_time')
  const items: string[] = []
  let hours: ChangeSummary['hours']

  for (const [field, raw] of fields) {
    const pair = pairOf(raw)
    if (field === 'hours') {
      hours = pair ? { from: formatValue(field, pair.from), to: formatValue(field, pair.to) } : null
      continue
    }
    if (COVERED_FIELDS.has(field)) {
      if (hasTimes) continue
      const label = field === 'clock_in_at' ? 'clock-in' : 'clock-out'
      if (pair && typeof pair.from === 'string' && typeof pair.to === 'string') {
        items.push(`${label} from ${formatGuamTime(pair.from)} to ${formatGuamTime(pair.to)}`)
      } else {
        items.push(label)
      }
      continue
    }
    if (VALUELESS_FIELDS[field]) {
      items.push(VALUELESS_FIELDS[field])
      continue
    }
    const label = VALUE_FIELDS[field] ?? humanize(field)
    if (pair && isPrimitive(pair.from) && isPrimitive(pair.to)) {
      items.push(`${label} from ${formatValue(field, pair.from)} to ${formatValue(field, pair.to)}`)
    } else {
      items.push(label)
    }
  }
  return { items, hours }
}

const hoursRange = (hours: ChangeSummary['hours']) => (hours ? ` from ${hours.from} to ${hours.to}` : '')

function reasonOf(details: Record<string, unknown> | undefined) {
  for (const key of ['correction_reason', 'reason', 'review_note']) {
    const value = details?.[key]
    if (typeof value === 'string' && value.trim()) return { key, text: value.trim() }
  }
  return null
}

/**
 * Plain sentences for one recorded change, e.g.
 * "Chels changed clock-out from 3:30 PM to 3:00 PM." "Hours changed from 8.0 to 7.5." "Reason: …".
 * Empty when the event recorded no field changes (the event's own summary says enough).
 */
export function describeChanges(event: Pick<AuditLogEntry, 'actor' | 'changes' | 'details'>): string[] {
  const actor = actorName(event)
  const { items, hours } = summarizeChanges(event.changes ?? {})
  const sentences: string[] = []
  if (items.length > 0) sentences.push(`${actor} changed ${joinList(items)}.`)
  if (hours !== undefined) {
    sentences.push(items.length > 0 ? `Hours changed${hoursRange(hours)}.` : `${actor} changed hours${hoursRange(hours)}.`)
  }
  const reason = reasonOf(event.details)
  if (sentences.length > 0 && reason) sentences.push(`Reason: ${reason.text}`)
  return sentences
}

// Fields of a before/after snapshot worth telling the office about.
const SNAPSHOT_FIELDS = ['work_date', 'start_time', 'end_time', 'clock_in_at', 'clock_out_at', 'hours', 'break_minutes', 'time_category_id', 'overtime_status', 'description', 'breaks']

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function snapshotChanges(before: Record<string, unknown>, after: Record<string, unknown>) {
  const changes: Record<string, { from: unknown; to: unknown }> = {}
  for (const field of SNAPSHOT_FIELDS) {
    if (!(field in before) && !(field in after)) continue
    const numeric = field === 'hours' || field === 'break_minutes'
    const was = numeric ? asNumber(before[field]) ?? before[field] ?? null : before[field] ?? null
    const now = numeric ? asNumber(after[field]) ?? after[field] ?? null : after[field] ?? null
    if (JSON.stringify(was) !== JSON.stringify(now)) changes[field] = { from: before[field] ?? null, to: after[field] ?? null }
  }
  return changes
}

const ending = (text: string) => (/[.!?]$/.test(text) ? text : `${text}.`)

export interface EventDescription {
  sentences: string[]
  /** Detail keys the sentences already say, so the panel doesn't repeat them. */
  usedKeys: string[]
  /** Plain detail keys that are raw request data: shown only under Details. */
  rawKeys?: string[]
}

// Rows written for any request that wasn't audited by hand are named "<area>.<action>" and keep
// the request itself in details. Those keys are for support, not for the office.
const REQUEST_KEYS = ['http_method', 'path', 'response_status', 'changed_fields', 'before_values', 'after_values', 'redacted_fields', 'error_message']

const REQUEST_VERBS: Record<string, string> = {
  update: 'change', create: 'add', destroy: 'delete', approve: 'approve', deny: 'deny', approve_overtime: 'approve overtime for',
  deny_overtime: 'deny overtime for', undo_approval: 'undo the approval of', bulk_approve: 'approve',
}
const REQUEST_NOUNS: Record<string, string> = {
  time_entries: 'this shift', users: 'this person', leave_requests: 'this leave request', schedules: 'this schedule',
  time_categories: 'this kind of work', settings: 'these settings', site_media: 'this photo',
}

function describeRequest(event: Pick<AuditLogEntry, 'action' | 'actor' | 'outcome' | 'details'>): EventDescription {
  const actor = actorName(event)
  const parts = event.action.split('.')
  const area = parts.length > 1 ? parts[parts.length - 2] : ''
  const action = parts[parts.length - 1]
  const verb = REQUEST_VERBS[action] ?? action.replaceAll('_', ' ')
  const noun = REQUEST_NOUNS[area] ?? 'this record'
  const message = typeof event.details?.error_message === 'string' ? event.details.error_message.trim() : ''
  const rawKeys = REQUEST_KEYS.filter((key) => key in (event.details ?? {}))
  if (event.outcome === 'failed') {
    return { sentences: [message ? `${actor} tried to ${verb} ${noun}, but it wasn't saved: ${ending(message)}` : `${actor} tried to ${verb} ${noun}, but it wasn't saved.`], usedKeys: [], rawKeys }
  }
  if (event.outcome === 'denied') {
    return { sentences: [`${actor} tried to ${verb} ${noun}, but wasn't allowed to.`], usedKeys: [], rawKeys }
  }
  return { sentences: [], usedKeys: [], rawKeys }
}

/**
 * What to say about an event's recorded changes. Handles field changes (`changes`) and the
 * before/after snapshots that review corrections and Payroll corrections keep in `details`.
 * An event with recorded changes we can't put into words still gets a plain sentence, never
 * raw data.
 */
export function describeEvent(event: Pick<AuditLogEntry, 'action' | 'actor' | 'changes' | 'details' | 'subject'> & { outcome?: string }): EventDescription {
  const actor = actorName(event)
  const details = event.details ?? {}
  if (typeof details.http_method === 'string' && typeof details.path === 'string') return describeRequest({ ...event, outcome: event.outcome ?? 'succeeded' })
  const before = isRecord(details.before) ? details.before : null
  const after = isRecord(details.after) ? details.after : null
  const hasChanges = Object.keys(event.changes ?? {}).length > 0
  const usedKeys: string[] = []

  if (!before && !after) {
    const sentences = describeChanges(event)
    if (sentences.some((sentence) => sentence.startsWith('Reason: '))) usedKeys.push(reasonOf(details)?.key ?? '')
    if (sentences.length === 0 && hasChanges) return { sentences: [`${actor} made a change to this ${event.subject?.type === 'TimeEntry' ? 'shift' : 'record'}.`], usedKeys }
    return { sentences, usedKeys }
  }

  const reason = reasonOf(details)
  if (reason) usedKeys.push(reason.key)
  const summary = summarizeChanges(snapshotChanges(before ?? {}, after ?? {}))
  const changed: string[] = []
  if (summary.items.length > 0) changed.push(`Changes: ${joinList(summary.items.map((item) => item.replace(/^the /, '')))}.`)
  if (summary.hours !== undefined) changed.push(`Hours changed${hoursRange(summary.hours)}.`)

  const sentences: string[] = []
  if (event.action === 'time_entry.clock_ended') {
    const stop = typeof after?.clock_out_at === 'string' ? after.clock_out_at : typeof after?.end_time === 'string' ? after.end_time : null
    const workDate = typeof after?.work_date === 'string' ? after.work_date : null
    const otherDay = stop && workDate && ISO_DATETIME.test(stop) && guamDay(stop) !== workDate ? ` on ${formatDay(guamDay(stop))}` : ''
    sentences.push(stop && ISO_DATETIME.test(stop) ? `${actor} ended the clock at ${formatTimeOfDay(stop)}${otherDay}.` : `${actor} ended the clock.`)
    const total = asNumber(after?.hours)
    if (total !== null) sentences.push(`The shift is now ${formatHours(total)} hours and waiting for approval.`)
    if (reason) sentences.push(`Reason: ${reason.text}`)
  } else if (event.action === 'time_entry.denied_resubmitted') {
    sentences.push(`${actor} changed the shift and sent it back for approval.`, ...changed)
    if (reason) sentences.push(`Reason: ${reason.text}`)
  } else if (event.action === 'payroll_cockpit.time_entry_corrected') {
    sentences.push(reason ? `${actor} corrected the shift from Payroll: ${ending(reason.text)}` : `${actor} corrected the shift from Payroll.`, ...changed)
  } else if (changed.length > 0 || hasChanges) {
    sentences.push(`${actor} made a change to this ${event.subject?.type === 'TimeEntry' ? 'shift' : 'record'}.`, ...changed)
  } else {
    sentences.push(`${actor} made a change to this ${event.subject?.type === 'TimeEntry' ? 'shift' : 'record'}.`)
  }
  return { sentences, usedKeys }
}
