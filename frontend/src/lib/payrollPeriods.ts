const BUSINESS_TIME_ZONE = 'Pacific/Guam'
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

export interface PayrollPeriod {
  start: string
  end: string
}

export function isIsoDate(value: string | null | undefined): value is string {
  if (!value || !ISO_DATE_PATTERN.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const parsed = new Date(Date.UTC(year, month - 1, day))
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day
}

export function currentPayrollPeriod(now = new Date()): PayrollPeriod {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value])) as Record<string, string>
  const dayNumber = Number(values.day)
  const lastDay = new Date(Date.UTC(Number(values.year), Number(values.month), 0)).getUTCDate()

  return dayNumber <= 15
    ? { start: `${values.year}-${values.month}-01`, end: `${values.year}-${values.month}-15` }
    : { start: `${values.year}-${values.month}-16`, end: `${values.year}-${values.month}-${String(lastDay).padStart(2, '0')}` }
}

export function payrollPeriodFromSearchParams(searchParams: URLSearchParams, fallback = currentPayrollPeriod()): PayrollPeriod {
  const start = searchParams.get('start_date')
  const end = searchParams.get('end_date')
  return isIsoDate(start) && isIsoDate(end) && start <= end ? { start, end } : fallback
}

export function formatPayrollDate(value: string, options: Intl.DateTimeFormatOptions = {}) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
    ...options,
  }).format(new Date(`${value}T12:00:00Z`))
}

export function formatPayrollPeriod(period: PayrollPeriod) {
  return `${formatPayrollDate(period.start)}–${formatPayrollDate(period.end)}`
}

export function greatestPayrollEndDate(batches: Array<{ end_date: string }>) {
  return batches.reduce<string | null>((greatest, batch) => {
    if (!isIsoDate(batch.end_date)) return greatest
    return !greatest || batch.end_date > greatest ? batch.end_date : greatest
  }, null)
}

export function withPayrollPeriod(path: string, period: PayrollPeriod, extra: Record<string, string> = {}) {
  const params = new URLSearchParams({ start_date: period.start, end_date: period.end, ...extra })
  return `${path}?${params.toString()}`
}
