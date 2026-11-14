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

function formatValue(field: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return 'not set'
  if (field === 'work_date' && typeof value === 'string') return formatDay(value)
  if (field === 'break_minutes' && typeof value === 'number') return formatMinutes(value)
  if (field === 'hours' && typeof value === 'number') return formatHours(value)
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

/**
 * Plain sentences for one recorded change, e.g.
 * "Chels changed clock-out from 3:30 PM to 3:00 PM." "Hours changed from 8.0 to 7.5." "Reason: …".
 * Empty when the event recorded no field changes (the event's own summary says enough).
 */
export function describeChanges(event: Pick<AuditLogEntry, 'actor' | 'changes' | 'details'>): string[] {
  const actor = actorName(event)
  const fields = Object.entries(event.changes ?? {})
  const hasTimes = fields.some(([field]) => field === 'start_time' || field === 'end_time')
  const items: string[] = []
  let hoursChange: { from: string; to: string } | null | undefined

  for (const [field, raw] of fields) {
    const pair = pairOf(raw)
    if (field === 'hours') {
      hoursChange = pair ? { from: formatValue(field, pair.from), to: formatValue(field, pair.to) } : null
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

  const sentences: string[] = []
  if (items.length > 0) sentences.push(`${actor} changed ${joinList(items)}.`)
  if (hoursChange !== undefined) {
    const range = hoursChange ? ` from ${hoursChange.from} to ${hoursChange.to}` : ''
    sentences.push(items.length > 0 ? `Hours changed${range}.` : `${actor} changed hours${range}.`)
  }

  const reason = event.details?.correction_reason ?? event.details?.review_note
  if (sentences.length > 0 && typeof reason === 'string' && reason.trim()) sentences.push(`Reason: ${reason.trim()}`)
  return sentences
}
