import { fetchApi } from '../api'
import type { PayrollLockPendingChange } from '../api'
import type { ConnectedPayrollCapability } from '../connectedPayroll'
import type { HandoffState } from '../payrollTerms'

// The pay period page's reads (docs/ATTENTION_CONNECTION_PERIODS_API.md).
// The lock control, preview, carryovers and exports keep using `api`.

export interface PayrollPeriodStep {
  key: Exclude<HandoffState, 'before_locking'>
  label: string
  state: 'done' | 'current' | 'upcoming'
}

export interface PayrollPeriodDelivery {
  status: 'pending' | 'failed' | 'delivered'
  stuck: boolean
  attempts: number
  occurred_at: string | null
  delivered_at: string | null
  last_error: string | null
}

export interface PayrollPeriodSummary {
  id: number
  external_pay_period_id: string
  start_date: string
  end_date: string
  pay_date: string
  cutoff_at: string
  lock_mode: 'scheduled' | 'manual'
  status: 'scheduled' | 'failed' | 'finalized'
  cutoff_state: string
  cutoff_source: string
  override: { reason: string | null; set_by_name: string | null; policy_cutoff_at: string | null } | null
  lock_change: PayrollLockPendingChange | null
  handoff_state: HandoffState
  label: string
  label_provisional: boolean
  steps: PayrollPeriodStep[]
  locked_at: string | null
  payroll_batch_id: string | null
  delivery: PayrollPeriodDelivery | null
  payroll_status: { status: string; occurred_at: string | null } | null
  people: number
  hours_source: 'live' | 'locked'
  /** Live (open) periods. */
  approved_hours?: number
  waiting_hours?: number
  waiting_count?: number
  /** Locked periods: the frozen batch summary. */
  locked_hours?: number
  locked_regular_hours?: number
  locked_overtime_hours?: number
}

export interface PayrollPeriodsResponse {
  periods: PayrollPeriodSummary[]
  /** The period the page treats as current: the earliest one not locked yet. */
  current_start_date: string | null
  connected_payroll: ConnectedPayrollCapability
}

export interface PayrollPeriodResponse {
  period: PayrollPeriodSummary
  previous_start_date: string | null
  next_start_date: string | null
  connected_payroll: ConnectedPayrollCapability
}

export const payrollPeriodApi = {
  periods: (limit = 12) => fetchApi<PayrollPeriodsResponse>(`/api/v1/payroll_periods?limit=${limit}`),
  period: (startDate: string) =>
    fetchApi<PayrollPeriodResponse>(`/api/v1/payroll_periods/${encodeURIComponent(startDate)}`),
}
