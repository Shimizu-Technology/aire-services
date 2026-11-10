import { getAuthTokenValue } from './api'
import { apiUrl } from './apiBase'
import { businessDateISO, formatDateOnly } from './dateUtils'

// The signed-in worker's own pay statements. The API derives the worker from
// the session; nothing here sends a worker or user identifier.

export type MyPayPaymentStatus = 'pending' | 'prepared' | 'issued' | 'voided'
export type MyPayPaymentMethod = 'paper_check' | 'direct_deposit'

export interface MyPayWorker {
  employment_type: 'hourly' | 'salary' | 'contractor' | null
  contractor: boolean
}

export interface MyPayStatementSummary {
  id: string
  pay_date: string | null
  check_date: string | null
  period_start: string | null
  period_end: string | null
  run_purpose: string | null
  gross_pay: string | null
  net_pay: string | null
  total_hours: string | null
  payment: {
    method: MyPayPaymentMethod | null
    status: MyPayPaymentStatus
    issued_on: string | null
    check_number_last4: string | null
  }
  has_source_entries: boolean
}

export interface MyPayEarning {
  /** May contain a line break before the stub's work-date note. */
  label: string
  hours: string | null
  rate: string | null
  /** How the stub prints `rate` when there are no hours: "salary" is per year, "contractor" is a flat fee. */
  pay_basis?: 'salary' | 'contractor' | null
  amount: string
  /** Year to date for this row, as the paper stub prints it; null where the stub prints a dash. */
  ytd?: string | null
  kind: 'regular' | 'overtime' | 'holiday' | 'pto' | 'bonus' | 'other'
  /** Contractors only: how an older row paid above the contract rate was paid. */
  note?: string
}

export interface MyPayWithholding {
  label: string
  amount: string
  ytd: string | null
}

export interface MyPayHoursLine {
  time_entry_id: number | null
  work_date: string | null
  category: string | null
  total_hours: string
  regular_hours?: string
  overtime_hours?: string
  source_kind: 'current' | 'carryover' | 'correction'
  prior_period: boolean
}

export interface MyPayStatementDetail extends MyPayStatementSummary {
  earnings: MyPayEarning[]
  taxes: MyPayWithholding[]
  deductions: MyPayWithholding[]
  /** Non-taxable additions such as reimbursements, added after taxes and deductions. */
  other_pay: MyPayWithholding[]
  ytd: { gross: string | null; net: string | null }
  hours_on_check: MyPayHoursLine[]
}

export type MyPayErrorCode = 'my_pay_unavailable' | 'payroll_not_linked' | 'statement_not_found' | 'my_pay_not_enabled' | 'network'

export class MyPayError extends Error {
  readonly code: MyPayErrorCode
  readonly status: number | undefined

  constructor(message: string, code: MyPayErrorCode, status?: number) {
    super(message)
    this.code = code
    this.status = status
  }
}

const UNAVAILABLE = 'Pay history is temporarily unavailable. Please try again in a few minutes.'
const KNOWN_CODES: MyPayErrorCode[] = ['my_pay_unavailable', 'payroll_not_linked', 'statement_not_found', 'my_pay_not_enabled']

async function authorizedFetch(path: string, signal?: AbortSignal): Promise<Response> {
  const token = await getAuthTokenValue()
  try {
    return await fetch(apiUrl(path), { signal, headers: token ? { Authorization: `Bearer ${token}` } : {} })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new MyPayError(UNAVAILABLE, 'network')
  }
}

async function failure(response: Response): Promise<MyPayError> {
  const data = await response.json().catch(() => null) as { error?: string; code?: string } | null
  const code = KNOWN_CODES.find((known) => known === data?.code) ?? (response.status === 404 ? 'statement_not_found' : 'my_pay_unavailable')
  return new MyPayError(data?.error || UNAVAILABLE, code, response.status)
}

async function readJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await authorizedFetch(path, signal)
  if (!response.ok) throw await failure(response)
  const data = await response.json().catch(() => null)
  if (!data) throw new MyPayError(UNAVAILABLE, 'my_pay_unavailable', response.status)
  return data as T
}

function statementPath(id: string): string {
  if (!/^[1-9]\d{0,17}$/.test(id)) throw new MyPayError("We couldn't find that paycheck.", 'statement_not_found', 404)
  return `/api/v1/my_pay/${id}`
}

export const myPayApi = {
  list: (signal?: AbortSignal) =>
    readJson<{ worker: MyPayWorker; statements: MyPayStatementSummary[] }>('/api/v1/my_pay', signal),
  statement: (id: string, signal?: AbortSignal) =>
    readJson<{ worker: MyPayWorker; statement: MyPayStatementDetail }>(statementPath(id), signal),
  async pdf(id: string): Promise<{ blob: Blob; filename: string }> {
    const response = await authorizedFetch(`${statementPath(id)}/pdf`)
    if (!response.ok) throw await failure(response)
    const disposition = response.headers.get('Content-Disposition') || ''
    const filename = disposition.match(/filename="?([^";]+)"?/i)?.[1] || `AIRE-pay-statement-${id}.pdf`
    return { blob: await response.blob(), filename }
  },
}

const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })

export function formatMoney(value: string | null | undefined): string {
  if (value == null || value === '' || Number.isNaN(Number(value))) return '—'
  return currency.format(Number(value))
}

export function formatHours(value: string | null | undefined): string {
  if (value == null || value === '' || Number.isNaN(Number(value))) return '—'
  const hours = Number(value)
  return `${hours.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ${hours === 1 ? 'hr' : 'hrs'}`
}

export function formatPayDate(date: string | null | undefined, options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' }): string {
  return date ? formatDateOnly(date, options) : 'Date not set'
}

export function formatPeriod(start: string | null, end: string | null): string {
  if (!start || !end) return 'Pay period not available'
  const sameYear = start.slice(0, 4) === end.slice(0, 4)
  return `${formatDateOnly(start, { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) })} – ${formatDateOnly(end, { month: 'short', day: 'numeric', year: 'numeric' })}`
}

export type StatusTone = 'success' | 'info' | 'neutral' | 'danger'

export interface PaymentStatusView {
  label: string
  tone: StatusTone
  /** False when there is nothing useful to badge, such as an older check with no recorded payment. */
  badge: boolean
  explanation?: string
}

// Plain words for the payment state of one check or deposit. Payroll marks a
// payment issued only from a delivery or transfer record, so an older check
// can still be "pending" or "prepared". Calling it "Processing" or "Check
// ready" months later would be wrong, and calling it "Paid" would be a guess.
export function paymentStatus(
  payment: MyPayStatementSummary['payment'],
  payDate: string | null = null,
  today: string = businessDateISO(),
): PaymentStatusView {
  const deposit = payment.method === 'direct_deposit'
  const past = Boolean(payDate && payDate < today)
  const undelivered = (label: string): PaymentStatusView => ({
    label,
    tone: 'neutral',
    badge: false,
    explanation: `Payroll hasn't recorded this ${deposit ? 'deposit' : 'check'} as delivered. If you didn't receive it, ask an AIRE administrator.`,
  })
  switch (payment.status) {
    case 'issued':
      return { label: deposit ? 'Deposited' : 'Paid', tone: 'success', badge: true }
    case 'prepared':
      if (past) return undelivered(deposit ? 'Deposit scheduled' : 'Check prepared')
      return { label: deposit ? 'Deposit scheduled' : 'Check ready', tone: 'info', badge: true }
    case 'voided':
      return { label: 'Voided', tone: 'danger', badge: true }
    default:
      if (past) return undelivered('Not recorded yet')
      return { label: 'Processing', tone: 'neutral', badge: true }
  }
}

export function paymentMethodLabel(method: MyPayPaymentMethod | null, last4: string | null): string {
  if (method === 'direct_deposit') return 'Direct deposit'
  if (method === 'paper_check') return last4 ? `Paper check ending ${last4}` : 'Paper check'
  return 'Payment method not recorded'
}

export function runPurposeLabel(purpose: string | null): string | null {
  if (!purpose || purpose === 'regular') return null
  return `${purpose.replace(/_/g, ' ').replace(/^./, (letter) => letter.toUpperCase())} payroll`
}
