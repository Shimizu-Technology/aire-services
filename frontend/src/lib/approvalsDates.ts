import { businessDateISO, formatDateOnly } from './dateUtils'

/** Date-only shift labels use Guam's current year, independent of the viewer's timezone. */
export function formatApprovalDate(date: string, now = new Date()) {
  return formatDateOnly(date, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(date.slice(0, 4) === businessDateISO(now).slice(0, 4) ? {} : { year: 'numeric' }),
  })
}

/** Compact group range: Nov 10–11, Oct 31–Nov 1, or one date for a single day. */
export function formatApprovalDateRange(dates: readonly string[], now = new Date()) {
  const ordered = [...dates].sort()
  const first = ordered[0]
  const last = ordered.at(-1)
  if (!first || !last) return ''

  const currentYear = businessDateISO(now).slice(0, 4)
  const sameYear = first.slice(0, 4) === last.slice(0, 4)
  const showYear = !sameYear || first.slice(0, 4) !== currentYear
  const label = (date: string) =>
    formatDateOnly(date, {
      month: 'short',
      day: 'numeric',
      ...(showYear ? { year: 'numeric' } : {}),
    })

  if (first === last) return label(first)
  if (first.slice(0, 7) === last.slice(0, 7)) {
    const month = formatDateOnly(first, { month: 'short' })
    const year = showYear ? `, ${first.slice(0, 4)}` : ''
    return `${month} ${Number(first.slice(8))}–${Number(last.slice(8))}${year}`
  }
  return `${label(first)}–${label(last)}`
}
