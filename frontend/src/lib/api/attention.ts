import { fetchApi } from '../api'
import type { ConnectedPayrollCapability } from '../connectedPayroll'

// Today's reads (docs/ATTENTION_CONNECTION_PERIODS_API.md). The lock time
// comes from `api.getPayrollCutoff()` and the people on the clock from
// `api.getWhosWorking()`; this module only adds the two PR 3 endpoints.

export interface AttentionPerson {
  id: number
  full_name: string
  display_name: string
}

interface AttentionBase {
  key: string
  tone: 'needs_fix' | 'waiting' | 'info'
}

/** An open clock: `open_clock_earlier_day` (a likely missed clock-out) or `long_clock_today` (over 12h). */
export interface ClockAttentionItem extends AttentionBase {
  type: 'open_clock_earlier_day' | 'long_clock_today'
  entry_id: number
  user: AttentionPerson
  work_date: string
  clock_in_at: string | null
  status: string
  hours_so_far: number
  time_category: { id: number; name: string } | null
}

export interface ApprovalsSummary {
  count: number
  total_hours: number
  oldest_work_date: string | null
  by_kind: { time: number; overtime: number; added: number; clocked: number }
}

export interface ApprovalsAttentionItem extends AttentionBase, ApprovalsSummary {
  type: 'approvals_waiting'
}

export interface OvertimeAttentionItem extends AttentionBase {
  type: 'overtime_waiting'
  count: number
  /** Null when some people's hours weren't projected (`hours_complete` is false). */
  hours: number | null
  hours_complete: boolean
  unprojected_count: number
  people: Array<AttentionPerson & { hours: number | null; entry_count: number; week_starts: string[] }>
}

export interface MissingCategoryAttentionItem extends AttentionBase {
  type: 'missing_category'
  count: number
  entry_ids: number[]
  period: { start_date: string; end_date: string }
}

export type PayrollProblemKind =
  | 'connection_paused'
  | 'lock_failed'
  | 'lock_overdue'
  | 'lock_change_pending'
  | 'lock_change_refused'
  | 'lock_change_expired'

export interface PayrollProblemAttentionItem extends AttentionBase {
  type: 'payroll_problem'
  problem: PayrollProblemKind
  message?: string
  period?: { id?: number; start_date: string; end_date: string }
  lock_mode?: 'manual' | 'scheduled'
  change?: {
    state: 'pending' | 'rejected' | 'expired'
    action: 'lock_now' | 'change' | 'reset'
    cutoff_at: string | null
    requested_by_name: string | null
    requested_at: string
    error: string | null
  }
}

export interface LeaveAttentionItem extends AttentionBase {
  type: 'leave_waiting'
  count: number
  next: {
    id: number
    user: AttentionPerson
    leave_type: string
    start_date: string | null
    end_date: string | null
  }
}

export interface KioskPinAttentionItem extends AttentionBase {
  type: 'kiosk_pin_locked'
  user: AttentionPerson
  locked_until: string
}

export interface PayStubAttentionItem extends AttentionBase {
  type: 'pay_stub_requests'
  count: number
  oldest_requested_at: string | null
}

export type AttentionItemData =
  | ClockAttentionItem
  | ApprovalsAttentionItem
  | OvertimeAttentionItem
  | MissingCategoryAttentionItem
  | PayrollProblemAttentionItem
  | LeaveAttentionItem
  | KioskPinAttentionItem
  | PayStubAttentionItem

export interface AttentionPeriod {
  published: boolean
  start_date: string
  end_date: string
  pay_date: string | null
  cutoff_at: string | null
  handoff_state: 'before_locking' | 'open' | 'locked' | 'received' | 'in_run' | 'paid'
  label: string
  label_provisional: boolean
  people: number
  approved_hours: number
  waiting_hours: number
  waiting_count: number
  hours_source: 'live' | 'locked'
}

export interface AttentionResponse {
  generated_at: string
  time_zone: string
  today: string
  count: number
  items: AttentionItemData[]
  approvals: ApprovalsSummary | null
  period: AttentionPeriod | null
  connected_payroll: ConnectedPayrollCapability
}

export interface PayrollConnectionStatus {
  mode: 'enabled' | 'paused'
  enabled: boolean
  message: string | null
  state: 'connected' | 'paused' | 'delivery_problem'
  last_publication: { published_at: string; start_date: string; end_date: string } | null
  last_delivery: {
    delivered_at: string | null
    occurred_at: string
    period: { start_date: string; end_date: string } | null
  } | null
  undelivered: { count: number; failed_count: number; stuck_count: number }
  account_link: { linked_at: string; connected: boolean } | null
}

export const attentionApi = {
  attention: () => fetchApi<AttentionResponse>('/api/v1/attention'),
  connection: () => fetchApi<PayrollConnectionStatus>('/api/v1/payroll_connection'),
}
