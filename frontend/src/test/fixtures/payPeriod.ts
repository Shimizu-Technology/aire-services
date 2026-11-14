import type { PayrollBatchDetail, PayrollBatchPayload, PayrollCarryoverItem } from '../../lib/api'
import type { PayrollPeriodSummary, PayrollPeriodsResponse } from '../../lib/api/payrollPeriod'

// Nov 1–15 (open, the current period) and Oct 16–31 (paid), as the PR 3
// endpoints and the batch preview return them. Times are Guam (UTC+10).

const steps = (current: PayrollPeriodSummary['handoff_state']): PayrollPeriodSummary['steps'] => {
  const keys = ['open', 'locked', 'received', 'in_run', 'paid'] as const
  const index = keys.indexOf(current as typeof keys[number])
  return keys.map((key, at) => ({ key, label: key, state: at < index || current === 'paid' ? 'done' : at === index ? 'current' : 'upcoming' }))
}

export function periodSummary(overrides: Partial<PayrollPeriodSummary> = {}): PayrollPeriodSummary {
  const state = overrides.handoff_state ?? 'open'
  return {
    id: 7, external_pay_period_id: 'ext-7', start_date: '2026-11-01', end_date: '2026-11-15', pay_date: '2026-11-25',
    cutoff_at: '2026-11-18T17:00:00+10:00', lock_mode: 'scheduled', status: 'scheduled', cutoff_state: 'upcoming',
    cutoff_source: 'policy', override: null, lock_change: null, handoff_state: state, label: 'Open', label_provisional: true,
    steps: steps(state), locked_at: null, payroll_batch_id: null, delivery: null, payroll_status: null,
    people: 30, hours_source: 'live', approved_hours: 1005, waiting_hours: 276.06, waiting_count: 31,
    ...overrides,
  }
}

/** Oct 16–31: locked Nov 2, paid Nov 10. */
export function paidPeriod(overrides: Partial<PayrollPeriodSummary> = {}): PayrollPeriodSummary {
  return periodSummary({
    id: 6, external_pay_period_id: 'ext-6', start_date: '2026-10-16', end_date: '2026-10-31', pay_date: '2026-11-10',
    cutoff_at: '2026-11-02T17:00:00+10:00', status: 'finalized', cutoff_state: 'finalized', handoff_state: 'paid', label: 'Paid',
    locked_at: '2026-11-02T17:00:05+10:00', payroll_batch_id: 'AIRE-PAY-20261031-OCT',
    payroll_status: { status: 'payment_issued', occurred_at: '2026-11-10T09:00:00+10:00' },
    hours_source: 'locked', approved_hours: undefined, waiting_hours: undefined, waiting_count: undefined,
    locked_hours: 1962.4, locked_regular_hours: 1900, locked_overtime_hours: 62.4,
    ...overrides,
  })
}

export function periodsIndex(periods: PayrollPeriodSummary[] = [periodSummary(), paidPeriod()], current: string | null = '2026-11-01'): PayrollPeriodsResponse {
  return { periods, current_start_date: current, connected_payroll: { mode: 'enabled', enabled: true, message: null } }
}

const line = (entry: string, date: string, hours: number, overtime = 0, sourceKind: 'current' | 'carryover' = 'current') => ({
  source_time_entry_id: entry, line_key: `category:3:${entry}`, source_kind: sourceKind, original_work_date: date,
  original_week_start: date, source_category_id: '3', category: { id: 3, key: 'ground', name: 'Ground Operations' },
  total_hours: hours + overtime, regular_hours: hours, overtime_hours: overtime,
})

/** Caleb (approved, still clocked in), Ethan (overtime waiting) and Jun (late hours from Oct 30). */
export function preview(overrides: Partial<PayrollBatchPayload> = {}): PayrollBatchPayload {
  return {
    schema_version: '2.0', source: 'aire_services', batch_id: 'PREVIEW', start_date: '2026-11-01', end_date: '2026-11-15',
    cutoff_at: '2026-11-18T07:00:00Z', generated_at: '2026-11-11T09:41:00Z', preview: true, can_finalize: true,
    connected_payroll: { mode: 'enabled', enabled: true, message: null },
    employees: [
      { source_user_id: '7', email: null, display_name: 'Caleb Perez', total_hours: 43.2, regular_hours: 43.2, overtime_hours: 0, adjustments: [line('701', '2026-11-03', 8.2), line('702', '2026-11-04', 35)] },
      { source_user_id: '9', email: null, display_name: 'Ethan Cruz', total_hours: 40, regular_hours: 40, overtime_hours: 0, adjustments: [line('901', '2026-11-05', 40)] },
      { source_user_id: '12', email: null, display_name: 'Jun Santos', total_hours: 8.9, regular_hours: 8.9, overtime_hours: 0, adjustments: [line('640', '2026-10-30', 8.9, 0, 'carryover')] },
    ],
    exclusions: [
      { source_time_entry_id: '812', source_user_id: '7', source_user_uuid: null, display_name: 'Caleb Perez', email: null, category: null, reason: 'open_clock', original_work_date: '2026-11-10', held_total_hours: 9.1, held_regular_hours: 9.1, held_overtime_hours: 0, first_excluded_batch_id: 'PREVIEW' },
      { source_time_entry_id: '905', source_user_id: '9', source_user_uuid: null, display_name: 'Ethan Cruz', email: null, category: null, reason: 'pending_overtime', original_work_date: '2026-11-09', held_total_hours: 10, held_regular_hours: 4, held_overtime_hours: 6, first_excluded_batch_id: 'PREVIEW' },
    ],
    issues: { missing_category_count: 0, negative_adjustment_count: 0, pending_approval_count: 0, denied_approval_count: 0, open_clock_count: 1, pending_overtime_count: 1, denied_overtime_count: 0 },
    summary: { employee_count: 3, adjustment_count: 4, total_hours: 92.1, regular_hours: 92.1, overtime_hours: 0, current_count: 3, carryover_count: 1, correction_count: 0, exclusion_count: 2 },
    published_calendar_periods: [{ external_pay_period_id: 'ext-7', start_date: '2026-11-01', end_date: '2026-11-15', cutoff_at: '2026-11-18T07:00:00Z', status: 'scheduled', payroll_batch_id: null }],
    ...overrides,
  }
}

/** The frozen Oct 16–31 batch. */
export function lockedBatch(): PayrollBatchDetail {
  const payload = preview({
    batch_id: 'AIRE-PAY-20261031-OCT', start_date: '2026-10-16', end_date: '2026-10-31', preview: undefined, can_finalize: undefined,
    employees: [{ source_user_id: '7', email: null, display_name: 'Caleb Perez', total_hours: 80, regular_hours: 76, overtime_hours: 4, adjustments: [line('601', '2026-10-20', 76, 4)] }],
    // Jun's Oct 30 shift was still waiting at the lock.
    exclusions: [{ source_time_entry_id: '640', source_user_id: '12', source_user_uuid: null, display_name: 'Jun Santos', email: null, category: null, reason: 'pending_approval', original_work_date: '2026-10-30', held_total_hours: 8.9, held_regular_hours: 8.9, held_overtime_hours: 0, first_excluded_batch_id: 'AIRE-PAY-20261031-OCT' }],
  })
  return {
    id: 'AIRE-PAY-20261031-OCT', start_date: '2026-10-16', end_date: '2026-10-31', cutoff_at: '2026-11-02T07:00:00Z',
    finalized_at: '2026-11-02T07:00:05Z', finalized_by: null, checksum: 'a'.repeat(64), processing: null,
    summary: payload.summary, issues: payload.issues, payload,
  }
}

export function carried(overrides: Partial<PayrollCarryoverItem> = {}): PayrollCarryoverItem {
  return {
    source_time_entry_id: '640', source_user_id: '12', display_name: 'Jun Santos', email: null, category: null,
    original_work_date: '2026-10-30', first_excluded_batch_id: 'AIRE-PAY-20261031-OCT', latest_excluded_batch_id: 'AIRE-PAY-20261031-OCT',
    exclusion_reason: 'approved_after_cutoff', held_total_hours: 8.9, current_total_hours: 8.9, status: 'ready_for_next_batch',
    included_batch: null,
    ...overrides,
  }
}
