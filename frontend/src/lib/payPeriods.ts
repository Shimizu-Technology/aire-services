import { currentPayrollPeriod, isIsoDate, type PayrollPeriod } from './payrollPeriods'

/**
 * Semimonthly pay periods on Guam time: the 1st–15th and the 16th to the last
 * day of the month. Dates are ISO strings (YYYY-MM-DD) with no time zone, so
 * the math never drifts with the device's clock settings. The lock time and
 * pay date come from Cornerstone Payroll; this only knows the calendar.
 */
export type PayPeriod = PayrollPeriod

const GUAM = 'Pacific/Guam'

function pad(value: number) {
  return String(value).padStart(2, '0')
}

function lastDayOfMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

function parts(date: string) {
  const [year, month, day] = date.split('-').map(Number)
  return { year, month, day }
}

/** Today's date in Guam, whatever the device's time zone. */
export function todayInGuam(now = new Date()) {
  const values = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: GUAM, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(now).map(part => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

/** The pay period that contains a date. */
export function payPeriodContaining(date: string): PayPeriod {
  if (!isIsoDate(date)) throw new Error(`Not a date: ${date}`)
  const { year, month, day } = parts(date)
  const prefix = `${year}-${pad(month)}`
  return day <= 15
    ? { start: `${prefix}-01`, end: `${prefix}-15` }
    : { start: `${prefix}-16`, end: `${prefix}-${pad(lastDayOfMonth(year, month))}` }
}

/** This pay period in Guam. */
export function currentPayPeriod(now = new Date()): PayPeriod {
  return currentPayrollPeriod(now)
}

/** Moves by whole periods: -1 is the previous one, 2 is the one after next. */
export function shiftPayPeriod(period: PayPeriod, offset: number): PayPeriod {
  const { year, month, day } = parts(period.start)
  // Count halves of months from year 0, so 24 steps is exactly a year.
  const index = year * 24 + (month - 1) * 2 + (day >= 16 ? 1 : 0) + offset
  const nextYear = Math.floor(index / 24)
  const nextMonth = Math.floor((index % 24) / 2) + 1
  return payPeriodContaining(`${nextYear}-${pad(nextMonth)}-${index % 2 === 0 ? '01' : '16'}`)
}

export const nextPayPeriod = (period: PayPeriod) => shiftPayPeriod(period, 1)
export const previousPayPeriod = (period: PayPeriod) => shiftPayPeriod(period, -1)

export function isSamePayPeriod(a: PayPeriod, b: PayPeriod) {
  return a.start === b.start && a.end === b.end
}

export function payPeriodIncludes(period: PayPeriod, date: string) {
  return date >= period.start && date <= period.end
}

/** Every date in the period, in order. */
export function payPeriodDays(period: PayPeriod) {
  const { year, month, day } = parts(period.start)
  const last = parts(period.end).day
  return Array.from({ length: last - day + 1 }, (_, index) => `${year}-${pad(month)}-${pad(day + index)}`)
}

/**
 * Reads `?period=2026-11-01`. Only the 1st or 16th of a month is a period
 * start; anything else (or nothing) gives null so the caller can fall back.
 */
export function parsePayPeriodStart(value: string | null | undefined): PayPeriod | null {
  if (!isIsoDate(value)) return null
  const period = payPeriodContaining(value)
  return period.start === value ? period : null
}

const MONTH = new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' })

/**
 * "Nov 1–15" or "Oct 16–31". The year is added when it isn't this year in
 * Guam ("Dec 16–31, 2025"), or always with `year: 'always'`.
 */
export function formatPayPeriod(period: PayPeriod, { year = 'auto', now = new Date() }: { year?: 'auto' | 'always' | 'never'; now?: Date } = {}) {
  const start = parts(period.start)
  const end = parts(period.end)
  const month = MONTH.format(new Date(Date.UTC(start.year, start.month - 1, 1)))
  const label = `${month} ${start.day}–${end.day}`
  const showYear = year === 'always' || (year === 'auto' && String(start.year) !== todayInGuam(now).slice(0, 4))
  return showYear ? `${label}, ${start.year}` : label
}
