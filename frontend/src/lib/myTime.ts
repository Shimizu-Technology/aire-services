import type {
  ClockLocationPayload,
  ClockStatus,
  TimeCategory,
  TimeEntry,
  UserSummary,
} from './api'
import { entrySegments, guamDate, timecardDays } from './timecards'
import { addDateDays, businessWeekStart } from './dateUtils'
import type { PayPeriod } from './payPeriods'

export const LOCATION_TIMEOUT =
  "Couldn't get your location. Step outside or near the office and try again."
export const OFFLINE_CLOCK =
  "No connection. Your clock-in wasn't sent. Check your signal and tap Clock in again. Nothing is saved until you see 'On the clock'."
export const OFFLINE_IDLE =
  'No connection. Clock actions are paused; this is your last saved status.'
export const LOCATION_BLOCKED =
  'Your phone is blocking location for AIRE. iPhone: Settings → Safari → Location → Allow. Android: Chrome → Site settings → Location. Still stuck? Use the office kiosk, or ask your manager to add your time.'

/** The API's out-of-range refusal, said with a next step. */
export function clockInRefusal(error: string, place?: string | null) {
  return /only allowed while you are at/i.test(error)
    ? `You need to be at ${place || 'AIRE Services Guam'} to clock in. If you're there, step outside for a better signal and try again.`
    : error
}

/** Where the clock stands, for the notice after a lost reply. */
export function clockStatusLine(status: ClockStatus) {
  if (!status.clocked_in) return "You're off the clock."
  if (status.active_break && status.active_break_started_at)
    return `You're on break since ${clockTime(status.active_break_started_at)}.`
  const since = status.session?.original_clock_in_at ?? status.clock_in_at
  return since
    ? `You're on the clock since ${clockTime(since)}.`
    : "You're on the clock."
}

/**
 * When someone who forgot to clock out says they stopped at `time` (HH:MM):
 * that time on the clock-in's Guam day, or the next morning if it's not after
 * the clock-in. Null unless it falls between the clock-in and now.
 */
export function stoppedAt(clockInAt: string, time: string, now = Date.now()) {
  if (!/^\d{2}:\d{2}$/.test(time)) return null
  const start = Date.parse(clockInAt)
  const day = guamDate(clockInAt)
  // Guam has no daylight saving: always UTC+10.
  let stop = Date.parse(`${day}T${time}:00+10:00`)
  if (stop <= start) stop += 86_400_000
  return stop > start && stop < now ? new Date(stop) : null
}

/** First names of the active managers who share the viewer's departments. */
export function approverNamesFor(people: UserSummary[], viewerId?: number) {
  const groups =
    people.find((person) => person.id === viewerId)?.approval_group_keys ?? []
  return people
    .filter(
      (person) =>
        person.role === 'manager' &&
        person.is_active &&
        person.id !== viewerId &&
        person.approval_group_keys?.some((group) => groups.includes(group)),
    )
    .map((person) => person.first_name || person.full_name)
}

/** Read whole Sunday–Saturday weeks so a period edge never resets overtime. */
export function weeksAround(period: PayPeriod) {
  return {
    start: businessWeekStart(addDateDays(period.start, -1)),
    end: addDateDays(businessWeekStart(period.end), 6),
  }
}

/**
 * Employee index reads don't include pending_overtime_hours. Allocate the
 * viewer's completed, non-denied hours in Guam day order, with the same 40h
 * Sunday workweek as WeeklyOvertimeAllocator. Overnight portions use the
 * shared Timecards split, so they consume capacity in the correct week.
 */
function overtimeSegments(entries: TimeEntry[]) {
  const cumulative = new Map<string, number>()
  const segments = entries
    .filter(employeeHoursBucket)
    .flatMap((entry) =>
      entrySegments(entry).map((segment) => ({ ...segment, entry })),
    )
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        (a.date === a.entry.work_date
          ? (a.entry.start_time ?? '')
          : '00:00'
        ).localeCompare(
          b.date === b.entry.work_date ? (b.entry.start_time ?? '') : '00:00',
        ) ||
        a.entry.created_at.localeCompare(b.entry.created_at) ||
        a.entry.id - b.entry.id,
    )
  return segments.map((segment) => {
    const week = businessWeekStart(segment.date)
    const before = cumulative.get(week) ?? 0
    const extra = Math.max(0, segment.hours - Math.max(0, 40 - before))
    cumulative.set(week, before + segment.hours)
    return { ...segment, overtime: extra }
  })
}

export function withOvertimeHours(entries: TimeEntry[]) {
  const overtime = new Map<number, number>()
  for (const segment of overtimeSegments(entries)) {
    overtime.set(
      segment.entry.id,
      (overtime.get(segment.entry.id) ?? 0) + segment.overtime,
    )
  }
  return entries.map((entry) => ({
    ...entry,
    pending_overtime_hours:
      entry.overtime_status === 'pending'
        ? (entry.pending_overtime_hours ??
          Math.round((overtime.get(entry.id) ?? 0) * 100) / 100)
        : 0,
  }))
}

/** Only the portions worked in this Sunday–Saturday week count here. */
export function employeeWeekTotals(entries: TimeEntry[], date: string) {
  const start = businessWeekStart(date)
  const end = addDateDays(start, 6)
  return overtimeSegments(entries)
    .filter((segment) => segment.date >= start && segment.date <= end)
    .reduce(
      (totals, segment) => ({
        hours: totals.hours + segment.hours,
        overtime:
          totals.overtime +
          (segment.entry.overtime_status === 'pending' ? segment.overtime : 0),
      }),
      { hours: 0, overtime: 0 },
    )
}

export function clockTime(value: string | Date) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'Pacific/Guam',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value))
}

export function needsClockOutConfirm(start: string, now = Date.now()) {
  const hours = (now - Date.parse(start)) / 3_600_000
  return hours < 1 || hours > 12
}

export function workedMilliseconds(status: ClockStatus, now = Date.now()) {
  if (!status.clock_in_at) return 0
  const stop =
    status.active_break_started_at && status.active_break
      ? Date.parse(status.active_break_started_at)
      : now
  // Completed segments already subtract their breaks in the API's
  // completed_work_seconds. Only subtract this segment's breaks here.
  const breaks = status.break_minutes
  return Math.max(
    0,
    stop -
      Date.parse(status.clock_in_at) +
      (status.session?.completed_work_seconds ?? 0) * 1000 -
      breaks * 60_000,
  )
}

export function chooseLastCategory(
  categories: TimeCategory[],
  entries: TimeEntry[],
  saved: number | null,
) {
  const latest = [...entries]
    .filter((entry) => entry.entry_method === 'clock')
    .sort((a, b) =>
      (b.clock_in_at ?? b.created_at).localeCompare(
        a.clock_in_at ?? a.created_at,
      ),
    )[0]
  const candidate = latest?.time_category?.id ?? saved
  return (
    categories.find((category) => category.id === candidate)?.id ??
    categories[0]?.id ??
    null
  )
}

/** A completed shift with no approval yet is waiting, never implicitly approved. */
export function employeeHoursBucket(entry: TimeEntry) {
  if (entry.status !== 'completed' || entry.approval_status === 'denied')
    return null
  return entry.approval_status === 'approved' ? 'approved' : 'waiting'
}

export function periodTotals(entries: TimeEntry[], period: PayPeriod) {
  const items = [...timecardDays(entries, period).values()]
    .flat()
    .filter((item) => employeeHoursBucket(item.entry))
  const sum = (status: 'approved' | 'waiting') =>
    items
      .filter((item) => employeeHoursBucket(item.entry) === status)
      .reduce((total, item) => total + item.hours, 0)
  const approved = sum('approved')
  const waiting = sum('waiting')
  return { total: approved + waiting, approved, waiting }
}

/** Keep the displayed tenths additive; retain exact hours for clock math. */
export function displayPeriodTotals(entries: TimeEntry[], period: PayPeriod) {
  const totals = periodTotals(entries, period)
  const approvedTenths = Math.round(totals.approved * 10)
  const waitingTenths = Math.round(totals.waiting * 10)
  return {
    total: (approvedTenths + waitingTenths) / 10,
    approved: approvedTenths / 10,
    waiting: waitingTenths / 10,
  }
}

/** Only a paid payload with a pay date can label the whole period Paid. */
export function periodPaidDate(entries: TimeEntry[]) {
  const payable = entries.filter((entry) => entry.approval_status !== 'denied')
  if (payable.some((entry) => entry.status !== 'completed')) return null
  const completed = payable.filter(
    (entry) => entry.status === 'completed' && entry.hours > 0,
  )
  if (
    !completed.length ||
    completed.some((entry) => entry.payroll_status?.status !== 'payment_issued')
  )
    return null
  const dates = completed
    .flatMap((entry) => entry.payroll_status?.paychecks ?? [])
    .map((check) => check.pay_date)
    .filter((date): date is string => !!date)
  return dates.sort().at(-1) ?? null
}

export function requestLocation(): Promise<ClockLocationPayload> {
  return new Promise((resolve, reject) => {
    // The browser's 10s acquisition timeout excludes its permission prompt.
    // This longer guard only covers providers that never call either callback.
    const timer = window.setTimeout(
      () => reject(new Error(LOCATION_TIMEOUT)),
      30_000,
    )
    const fail = (message: string) => {
      window.clearTimeout(timer)
      reject(new Error(message))
    }
    if (!navigator.geolocation) return fail(LOCATION_TIMEOUT)
    navigator.geolocation.getCurrentPosition(
      (position) => {
        window.clearTimeout(timer)
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy_meters: Math.round(position.coords.accuracy),
        })
      },
      (error) =>
        fail(
          error.code === 1 ? LOCATION_BLOCKED : LOCATION_TIMEOUT,
        ),
      {
        enableHighAccuracy: true,
        timeout: 10_000,
        maximumAge: 0,
      },
    )
  })
}
