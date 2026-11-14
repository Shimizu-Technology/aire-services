// AIRE locks on Guam time, which has no daylight saving: UTC+10 all year.
const GUAM = 'Pacific/Guam'
const GUAM_OFFSET = '+10:00'
const DAY = 86_400_000

const part = (value: Date, options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-US', { timeZone: GUAM, ...options }).format(value)
// en-CA formats a date as YYYY-MM-DD.
const guamDay = (value: Date) => Date.parse(`${new Intl.DateTimeFormat('en-CA', { timeZone: GUAM, year: 'numeric', month: '2-digit', day: '2-digit' }).format(value)}T00:00:00Z`)

/** "Sat, Nov 22 at 5:00 PM" in Guam time. */
export function formatLockTime(iso: string) {
  const value = new Date(iso)
  return `${part(value, { weekday: 'short', month: 'short', day: 'numeric' })} at ${part(value, { hour: 'numeric', minute: '2-digit' })}`
}

/** "in 3 days", "tomorrow", "in 5 hours", "in 12 minutes", or "now". */
export function lockDistance(iso: string, now: Date) {
  const target = new Date(iso)
  const ms = target.getTime() - now.getTime()
  if (ms <= 60_000) return 'now'
  const minutes = Math.round(ms / 60_000)
  if (minutes < 60) return `in ${minutes} minute${minutes === 1 ? '' : 's'}`
  const days = Math.round((guamDay(target) - guamDay(now)) / DAY)
  if (days === 0) {
    const hours = Math.round(minutes / 60)
    return `in ${hours} hour${hours === 1 ? '' : 's'}`
  }
  if (days === 1) return 'tomorrow'
  return `in ${days} days`
}

/** ISO instant to a datetime-local value in Guam time ("2026-11-22T17:00"). */
export function toGuamInput(iso: string) {
  return new Date(new Date(iso).getTime() + 10 * 3_600_000).toISOString().slice(0, 16)
}

/** A datetime-local value entered as Guam time to an ISO instant with offset. */
export function fromGuamInput(value: string) {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) ? `${value}:00${GUAM_OFFSET}` : null
}

/** The first whole minute at least 15 minutes after now, as Cornerstone requires for a new lock time. */
export function earliestLockChange(now: Date) {
  return new Date(Math.ceil((now.getTime() + 15 * 60_000) / 60_000) * 60_000)
}
