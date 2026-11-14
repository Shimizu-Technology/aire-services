import type { ClockLocationPayload, ClockStatus, TimeCategory, TimeEntry } from './api'
import { timecardDays } from './timecards'
import type { PayPeriod } from './payPeriods'

export const LOCATION_TIMEOUT = "Couldn't get your location. Step outside or near the office and try again."
export const OFFLINE_CLOCK = "No connection. Your clock-in wasn't sent. Check your signal and tap Clock in again. Nothing is saved until you see 'On the clock'."

export function clockTime(value: string | Date) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'Pacific/Guam', hour: 'numeric', minute: '2-digit',
  }).format(new Date(value))
}

export function needsClockOutConfirm(start: string, now = Date.now()) {
  const hours = (now - Date.parse(start)) / 3_600_000
  return hours < 1 || hours > 12
}

export function workedMilliseconds(status: ClockStatus, now = Date.now()) {
  if (!status.clock_in_at) return 0
  const stop = status.active_break_started_at && status.active_break
    ? Date.parse(status.active_break_started_at) : now
  // Completed segments already subtract their breaks in the API's
  // completed_work_seconds. Only subtract this segment's breaks here.
  const breaks = status.break_minutes
  return Math.max(0, stop - Date.parse(status.clock_in_at)
    + (status.session?.completed_work_seconds ?? 0) * 1000
    - breaks * 60_000)
}

export function chooseLastCategory(categories: TimeCategory[], entries: TimeEntry[], saved: number | null) {
  const latest = [...entries].filter(entry => entry.entry_method === 'clock')
    .sort((a, b) => (b.clock_in_at ?? b.created_at).localeCompare(a.clock_in_at ?? a.created_at))[0]
  const candidate = latest?.time_category?.id ?? saved
  return categories.find(category => category.id === candidate)?.id
    ?? categories[0]?.id ?? null
}

export function periodTotals(entries: TimeEntry[], period: PayPeriod) {
  const items = [...timecardDays(entries, period).values()].flat()
    .filter(item => item.entry.status === 'completed')
  const sum = (status?: string) => items
    .filter(item => !status || item.entry.approval_status === status)
    .reduce((total, item) => total + item.hours, 0)
  return { total: sum(), approved: sum('approved'), waiting: sum('pending') }
}

/** Only a paid payload with a pay date can label the whole period Paid. */
export function periodPaidDate(entries: TimeEntry[]) {
  const completed = entries.filter(entry => entry.status === 'completed' && entry.hours > 0)
  if (!completed.length || completed.some(entry =>
    entry.payroll_status?.status !== 'payment_issued')) return null
  const dates = completed.flatMap(entry => entry.payroll_status?.paychecks ?? [])
    .map(check => check.pay_date).filter((date): date is string => !!date)
  return dates.sort().at(-1) ?? null
}

export function requestLocation(): Promise<ClockLocationPayload> {
  return new Promise((resolve, reject) => {
    // An explicit timer covers browsers/providers that fail to call either
    // geolocation callback. No punch is sent until location succeeds.
    const timer = window.setTimeout(() => reject(new Error(LOCATION_TIMEOUT)), 10_000)
    const fail = (message: string) => {
      window.clearTimeout(timer)
      reject(new Error(message))
    }
    if (!navigator.geolocation) return fail(LOCATION_TIMEOUT)
    navigator.geolocation.getCurrentPosition(position => {
      window.clearTimeout(timer)
      resolve({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy_meters: Math.round(position.coords.accuracy),
      })
    }, error => fail(error.code === 1
      ? 'Location access is required to clock in. Allow location in your browser settings and try again.'
      : LOCATION_TIMEOUT), {
      enableHighAccuracy: true, timeout: 10_000, maximumAge: 0,
    })
  })
}
