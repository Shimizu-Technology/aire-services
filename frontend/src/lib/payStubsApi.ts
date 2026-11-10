import { getAuthTokenValue } from './api'
import { apiUrl } from './apiBase'
import type { UserRole } from './roles'

// Pay stub requests and secure links. Nothing here carries pay amounts: the
// API returns pay dates and periods only, so managers can send stubs too.

export type PayStubScope = 'latest' | 'pay_date' | 'year'
export type PayStubRecipientKind = 'on_file' | 'typed'
export type PayStubLinkState = 'active' | 'pending' | 'expired' | 'revoked' | 'used_up' | 'failed' | 'inactive'

export interface PayStubWorker {
  id: number
  name: string
  first_name: string
  role: UserRole
  /** Shown in full to owners and admins, masked ("m•••@example.com") for managers. */
  on_file_email: string | null
}

export interface PayStubDate {
  id: string
  pay_date: string | null
  period_start: string | null
  period_end: string | null
  /** Owners and admins only; managers don't see which run a check came from. */
  run_purpose?: string | null
  voided: boolean
}

export interface PayStubLink {
  id: number
  state: PayStubLinkState
  origin: 'sender' | 'self'
  worker: { id: number; name: string }
  sent_by: string
  recipient_email: string
  recipient_kind: PayStubRecipientKind
  request_id: number | null
  sent_at: string
  expires_at: string
  revoked_at: string | null
  revoked_by: string | null
  max_downloads_per_document: number
  documents: { id: number; pay_date: string | null; period_start: string | null; period_end: string | null; downloads_used: number }[]
}

export interface PayStubRequest {
  id: number
  status: 'open' | 'fulfilled' | 'dismissed'
  source: 'kiosk' | 'web'
  scope: PayStubScope
  statement_id: string | null
  pay_date: string | null
  year: number | null
  worker: PayStubWorker
  recipient_kind: PayStubRecipientKind
  /** The typed address, or the email on file now (masked for managers); null when there's none on file. */
  recipient_email: string | null
  /** False for a manager when the request names an address that isn't on file. */
  can_send: boolean
  requested_at: string
  resolved_at: string | null
  resolved_by: string | null
  resolution_note: string | null
  links: PayStubLink[]
}

export interface KioskPayStubChoices {
  pay_dates: { statement_id: string; pay_date: string | null }[]
  years: number[]
  /** False when payroll couldn't be reached; "latest" and a year still work. */
  pay_dates_available: boolean
  /** A masked address such as "m•••@example.com", or null when none is on file. */
  on_file_email_hint: string | null
}

export interface PayStubLinkSummary {
  state: PayStubLinkState
  message: string | null
  employer: string
  first_name: string
  expires_at: string
  downloads_per_document: number
  documents: { id: number; kind: string; pay_date: string | null; period_start: string | null; period_end: string | null; downloads_left: number }[]
}

export class PayStubError extends Error {
  readonly code: string
  readonly status: number | undefined

  constructor(message: string, code: string, status?: number) {
    super(message)
    this.code = code
    this.status = status
  }
}

const UNAVAILABLE = 'Something went wrong. Please try again in a few minutes.'

interface CallOptions {
  method?: 'GET' | 'POST' | 'PATCH'
  body?: unknown
  auth?: boolean
  signal?: AbortSignal
}

async function send(path: string, { method = 'GET', body, auth = true, signal }: CallOptions): Promise<Response> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (auth) {
    const token = await getAuthTokenValue()
    if (token) headers.Authorization = `Bearer ${token}`
  }
  try {
    return await fetch(apiUrl(path), { method, headers, signal, body: body === undefined ? undefined : JSON.stringify(body) })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new PayStubError("We couldn't reach AIRE. Check your connection and try again.", 'network')
  }
}

async function failure(response: Response): Promise<PayStubError> {
  const data = await response.json().catch(() => null) as { error?: string; code?: string } | null
  const fallback = response.status === 429 ? 'Too many tries. Please wait a few minutes and try again.' : UNAVAILABLE
  return new PayStubError(data?.error || fallback, data?.code || (response.status === 429 ? 'rate_limited' : 'unavailable'), response.status)
}

async function call<T>(path: string, options: CallOptions = {}): Promise<T> {
  const response = await send(path, options)
  if (!response.ok) throw await failure(response)
  return await response.json() as T
}

async function callPdf(path: string, body: unknown, fallbackName: string): Promise<{ blob: Blob; filename: string }> {
  const response = await send(path, { method: 'POST', body, auth: false })
  if (!response.ok) throw await failure(response)
  const disposition = response.headers.get('Content-Disposition') || ''
  const filename = disposition.match(/filename="?([^";]+)"?/i)?.[1] || fallbackName
  return { blob: await response.blob(), filename }
}

/** Save a downloaded PDF the way the My Pay download does. */
export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}

const ID = /^[1-9]\d{0,17}$/
function id(value: string | number): string {
  const text = String(value)
  if (!ID.test(text)) throw new PayStubError("We couldn't find that record.", 'not_found', 404)
  return text
}

export interface SendPayStubInput {
  userId: number
  statementIds: string[]
  email?: string
  emailConfirmation?: string
  requestId?: number | null
}

// Senders: owners, admins and managers (send_pay_statements).
export const payStubsApi = {
  workers: (signal?: AbortSignal) => call<{ workers: PayStubWorker[]; can_choose_recipient: boolean }>('/api/v1/pay_stubs/workers', { signal }),
  worker: async (userId: string | number, signal?: AbortSignal) => call<{ worker: PayStubWorker }>(`/api/v1/pay_stubs/workers/${id(userId)}`, { signal }),
  statements: async (userId: string | number, signal?: AbortSignal) => call<{ statements: PayStubDate[] }>(`/api/v1/pay_stubs/workers/${id(userId)}/statements`, { signal }),
  requests: (status: 'open' | 'closed', signal?: AbortSignal) => call<{ requests: PayStubRequest[]; open_count: number }>(`/api/v1/pay_stubs/requests?status=${status}`, { signal }),
  dismiss: async (requestId: number, note: string) => call<{ request: PayStubRequest }>(`/api/v1/pay_stubs/requests/${id(requestId)}/dismiss`, { method: 'POST', body: { note } }),
  links: (userId?: number | null, signal?: AbortSignal) => call<{ links: PayStubLink[] }>(`/api/v1/pay_stubs/links${userId ? `?user_id=${id(userId)}` : ''}`, { signal }),
  send: (input: SendPayStubInput) => call<{ link: PayStubLink; email_status: 'sent' | 'captured' }>('/api/v1/pay_stubs/links', {
    method: 'POST',
    body: {
      user_id: input.userId,
      statement_ids: input.statementIds,
      ...(input.email ? { email: input.email, email_confirmation: input.emailConfirmation ?? '' } : {}),
      ...(input.requestId ? { request_id: input.requestId } : {}),
    },
  }),
  revoke: async (linkId: number) => call<{ link: PayStubLink }>(`/api/v1/pay_stubs/links/${id(linkId)}/revoke`, { method: 'POST' }),
  notificationEmails: (signal?: AbortSignal) => call<{ emails: string[]; editable: boolean }>('/api/v1/pay_stubs/notification_emails', { signal }),
  updateNotificationEmails: (emails: string) => call<{ emails: string[]; editable: boolean }>('/api/v1/pay_stubs/notification_emails', { method: 'PATCH', body: { emails } }),
}

// The signed-in worker's own stub, from My Pay, to the email on file.
export const myPayEmailApi = {
  email: async (statementId: string) => call<{ sent_to: string | null; expires_at: string; email_status: string }>(`/api/v1/my_pay/${id(statementId)}/email`, { method: 'POST' }),
}

export interface KioskPayStubRequestInput {
  scope: PayStubScope
  statementId?: string
  year?: number
  email?: string
  emailConfirmation?: string
}

// The shared kiosk, after PIN verification; uses the clock's kiosk tokens.
export const kioskPayStubsApi = {
  choices: (kioskAccessToken: string, kioskToken: string) => call<KioskPayStubChoices>('/api/v1/aire/kiosk/pay_stubs/choices', {
    method: 'POST', auth: false, body: { kiosk_access_token: kioskAccessToken, kiosk_token: kioskToken },
  }),
  request: (kioskAccessToken: string, kioskToken: string, input: KioskPayStubRequestInput) => call<{ message: string }>('/api/v1/aire/kiosk/pay_stubs', {
    method: 'POST',
    auth: false,
    body: {
      kiosk_access_token: kioskAccessToken,
      kiosk_token: kioskToken,
      scope: input.scope,
      ...(input.statementId ? { statement_id: input.statementId } : {}),
      ...(input.year ? { year: input.year } : {}),
      ...(input.email ? { email: input.email, email_confirmation: input.emailConfirmation ?? '' } : {}),
    },
  }),
}

// The public link page. The token is sent in the body, never in a URL.
export const payStubLinkApi = {
  lookup: (token: string, signal?: AbortSignal) => call<PayStubLinkSummary>('/api/v1/pay_stub_links/lookup', { method: 'POST', auth: false, body: { token }, signal }),
  download: (token: string, documentId: number) => callPdf('/api/v1/pay_stub_links/download', { token, document_id: documentId }, 'AIRE-pay-stub.pdf'),
  downloadAll: (token: string) => callPdf('/api/v1/pay_stub_links/download_all', { token }, 'AIRE-pay-stubs.pdf'),
}
