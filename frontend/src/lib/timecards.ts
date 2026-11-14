import type { TimeEntry, UserSummary, WorkerStatus } from './api'
import type { TimecardSummaryEmployee } from './api/timecards'
import { addDateDays } from './dateUtils'

// Time math for Timecards. AIRE works on Guam time, which is UTC+10 all year
// with no daylight saving, so clock times convert with a fixed offset.
const GUAM = 'Pacific/Guam'
const GUAM_OFFSET = '+10:00'
const MINUTE = 60_000

const guamParts = (instant: string | Date) => Object.fromEntries(
  new Intl.DateTimeFormat('en-CA', { timeZone: GUAM, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(instant)).map(part => [part.type, part.value]),
)

/** The Guam date of an instant, YYYY-MM-DD. */
export function guamDate(instant: string | Date) {
  const parts = guamParts(instant)
  return `${parts.year}-${parts.month}-${parts.day}`
}

/** The Guam clock time of an instant, HH:MM. */
export function guamClock(instant: string | Date) {
  const parts = guamParts(instant)
  return `${parts.hour}:${parts.minute}`
}

/** A Guam date and HH:MM as an instant. */
export function guamInstant(date: string, time: string) {
  return new Date(`${date}T${time}:00${GUAM_OFFSET}`)
}

/**
 * The day a clock-out lands on. Mirrors the API's clock-time normalisation
 * (`time_on_work_date` with `after:`): a time at or before the clock-in time
 * of day belongs to the next day, so 10:30 PM to 6:30 AM ends the next morning.
 */
export function clockOutDate(clockInAt: string, endTime: string) {
  const inDate = guamDate(clockInAt)
  return endTime <= guamClock(clockInAt) ? addDateDays(inDate, 1) : inDate
}

export interface ClockOutPreview {
  /** The Guam date the clock-out lands on. */
  stopDate: string
  /** Break minutes that will count, with an open break ending at clock-out. */
  breakMinutes: number
  /** Paid hours after breaks. */
  hours: number
  /** Why it can't be saved yet, in a sentence. */
  problem: string | null
}

/** What ending an open clock at `endTime` would save, before it's saved. */
export function previewClockOut(entry: Pick<TimeEntry, 'clock_in_at' | 'start_time' | 'work_date' | 'break_minutes' | 'breaks'>, endTime: string, now = new Date()): ClockOutPreview | null {
  if (!/^\d{2}:\d{2}$/.test(endTime)) return null
  const clockIn = entry.clock_in_at ?? (entry.start_time ? guamInstant(entry.work_date, entry.start_time).toISOString() : null)
  if (!clockIn) return null
  const stopDate = clockOutDate(clockIn, endTime)
  const stop = guamInstant(stopDate, endTime)
  const breakMinutes = entry.breaks.length === 0
    ? entry.break_minutes ?? 0
    : entry.breaks.reduce((sum, row) => {
      if (row.end_time) return sum + (row.duration_minutes ?? Math.round((Date.parse(row.end_time) - Date.parse(row.start_time)) / MINUTE))
      return sum + Math.max(0, Math.round((stop.getTime() - Date.parse(row.start_time)) / MINUTE))
    }, 0)
  const workedMinutes = (stop.getTime() - Date.parse(clockIn)) / MINUTE - breakMinutes
  const hours = Math.max(0, Math.round(workedMinutes / 6) / 10)
  const problem = stop.getTime() > now.getTime()
    ? "That's in the future. Pick the time they actually left."
    : workedMinutes <= 0 ? 'The clock-out has to come after the clock-in and any breaks.' : null
  return { stopDate, breakMinutes, hours, problem }
}

const HOUR = 3_600_000
const round2 = (value: number) => Math.round(value * 100) / 100

/**
 * A completed shift's paid hours by Guam day, split at midnight the way the
 * hours report splits it (Payroll::PayableIntervals): time on each side, less
 * the breaks on that side, scaled so the parts add up to the shift's hours.
 */
export function entrySegments(entry: Pick<TimeEntry, 'work_date' | 'start_time' | 'end_time' | 'hours' | 'breaks' | 'status'>): Array<{ date: string; hours: number }> {
  const whole = [{ date: entry.work_date, hours: entry.hours }]
  if (entry.status !== 'completed' || !entry.start_time || !entry.end_time) return whole
  const from = guamInstant(entry.work_date, entry.start_time).getTime()
  let to = guamInstant(entry.work_date, entry.end_time).getTime()
  if (to <= from) to += 24 * HOUR
  const nextDay = addDateDays(entry.work_date, 1)
  const midnight = guamInstant(nextDay, '00:00').getTime()
  if (to <= midnight) return whole
  const worked = (start: number, end: number) => (end - start) - entry.breaks.reduce((sum, row) => {
    if (!row.end_time) return sum
    return sum + Math.max(0, Math.min(end, Date.parse(row.end_time)) - Math.max(start, Date.parse(row.start_time)))
  }, 0)
  const before = worked(from, midnight)
  const after = worked(midnight, to)
  const first = before + after > 0 ? round2(entry.hours * before / (before + after)) : 0
  return [{ date: entry.work_date, hours: first }, { date: nextDay, hours: round2(entry.hours - first) }]
}

export interface TimecardDayItem {
  entry: TimeEntry
  /** This period's hours of the shift. */
  hours: number
  /** The shift's own date, when this is the part of an earlier shift that runs into the period. */
  continuesFrom: string | null
  /** The shift crosses the period's edge, so `hours` is only this period's part. */
  partial: boolean
}

/**
 * Each day's shifts for a pay period. A shift that started the day before the
 * period and ran past midnight shows on the day it continues into, with only
 * the hours that fall in this period, as the hours report counts them.
 */
export function timecardDays(entries: TimeEntry[], period: { start: string; end: string }) {
  const days = new Map<string, TimecardDayItem[]>()
  const inPeriod = (date: string) => date >= period.start && date <= period.end
  for (const entry of entries) {
    const segments = entrySegments(entry)
    const here = segments.filter(segment => inPeriod(segment.date))
    if (here.length === 0) continue
    const date = inPeriod(entry.work_date) ? entry.work_date : here[0].date
    const item: TimecardDayItem = {
      entry,
      hours: round2(here.reduce((sum, segment) => sum + segment.hours, 0)),
      continuesFrom: date === entry.work_date ? null : entry.work_date,
      partial: here.length < segments.length,
    }
    days.set(date, [...(days.get(date) ?? []), item])
  }
  const order = (item: TimecardDayItem) => (item.continuesFrom ? '' : item.entry.clock_in_at ?? item.entry.start_time ?? '')
  for (const list of days.values()) list.sort((a, b) => order(a).localeCompare(order(b)) || a.entry.id - b.entry.id)
  return days
}

/** Hours for a typed-in shift, as the API counts them. An end before the start runs past midnight. */
export function manualShiftHours(start: string, end: string, breakMinutes: number | null) {
  if (!/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end)) return 0
  const toMinutes = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3))
  let minutes = toMinutes(end) - toMinutes(start)
  if (minutes < 0) minutes += 24 * 60
  return Math.max(0, Math.round((minutes - (breakMinutes ?? 0)) / 6) / 10)
}

/** Hours since an instant, to one decimal: "still clocked in 36.7h". */
export function hoursSince(instant: string, now = new Date()) {
  return Math.max(0, Math.round((now.getTime() - Date.parse(instant)) / 360_000) / 10)
}

/** "7:02 AM" to "7:02a". */
export function shortClock(value: string | null | undefined) {
  return value ? value.replace(/\s?([AP])M$/i, (_, half: string) => half.toLowerCase()) : ''
}

export const formatHours = (value: number) => `${(Math.round(value * 10) / 10).toFixed(1)}h`

export const isOpenClock = (entry: Pick<TimeEntry, 'status'>) => entry.status === 'clocked_in' || entry.status === 'on_break'

/** Counts toward pay now, the way the hours report counts it. */
export const isApprovedTime = (entry: Pick<TimeEntry, 'status' | 'entry_method' | 'approval_status'>) =>
  entry.status === 'completed' && (entry.entry_method === 'clock' ? entry.approval_status !== 'pending' && entry.approval_status !== 'denied' : entry.approval_status === 'approved')

export type OpenClockState = 'stale' | 'live' | null

export interface TimecardPersonRow {
  id: number
  name: string
  firstName: string
  /** Department labels, e.g. ["CFI"]. */
  groups: string[]
  employmentStatus: UserSummary['employment_status']
  terminationEffectiveOn: string | null
  timeCategoryIds: number[]
  /** Approved hours this period; null when the summary couldn't load. */
  approvedHours: number | null
  waitingCount: number
  overtimeWaitingCount: number
  openClock: OpenClockState
  /** The open clock's work date when it's from an earlier day. */
  openSince: string | null
  needsLook: boolean
}

export const personName = (user: Pick<UserSummary, 'full_name' | 'display_name' | 'email'>) =>
  user.full_name || user.display_name || user.email?.split('@')[0] || 'Team member'

/**
 * One row per person for the people list: the staff directory, this period's
 * totals and flags, and who's clocked in right now. "Needs a look" means an
 * open clock from an earlier day, or time or overtime waiting for approval.
 */
export function buildPeopleRows(users: UserSummary[], summary: TimecardSummaryEmployee[] | null, workers: WorkerStatus[], today: string): TimecardPersonRow[] {
  const byId = new Map(summary?.map(row => [row.id, row]))
  const workerById = new Map(workers.map(worker => [worker.user.id, worker]))
  return users.flatMap((user) => {
    const row = byId.get(user.id)
    const worker = workerById.get(user.id)
    const gone = user.employment_status === 'terminated' || user.employment_status === 'inactive'
    // With a summary, list the people who track time (it includes everyone who
    // does) plus anyone with time this period; without one, everyone current.
    if (summary ? !row || (gone && row.entries_count === 0 && row.issues.pending_count === 0 && row.issues.open_clock_count === 0) : gone) return []
    const openSince = worker?.open_since_work_date ?? null
    const live = worker?.status === 'clocked_in' || worker?.status === 'on_break'
    const openClock: OpenClockState = openSince && openSince < today ? 'stale' : live ? 'live' : !worker && (row?.issues.open_clock_count ?? 0) > 0 ? 'stale' : null
    const waitingCount = row?.issues.pending_count ?? 0
    const overtimeWaitingCount = row?.issues.pending_overtime_count ?? 0
    const name = personName(user)
    return [{
      id: user.id,
      name,
      firstName: user.first_name || name.split(/\s+/)[0],
      groups: user.approval_group_labels?.length ? user.approval_group_labels : user.approval_group_label ? [user.approval_group_label] : [],
      employmentStatus: user.employment_status,
      terminationEffectiveOn: user.termination_effective_on ?? null,
      timeCategoryIds: user.time_category_ids ?? [],
      approvedHours: row ? row.total_hours : null,
      waitingCount,
      overtimeWaitingCount,
      openClock,
      openSince: openClock === 'stale' ? openSince : null,
      needsLook: openClock === 'stale' || waitingCount > 0 || overtimeWaitingCount > 0,
    }]
  })
}
