import { getAuthTokenValue, type AdminUser, type Schedule, type AuditLogEntry } from './api'
import { apiUrl } from './apiBase'

export interface EvidenceTotals {
  worked_hours: number; eligible_hours: number; pending_hours: number; denied_hours: number
  issued_hours: number; committed_hours: number; exported_hours: number; held_hours: number; needs_reconciliation_hours: number
  current_regular_hours: number; current_overtime_hours: number; frozen_regular_hours: number; frozen_overtime_hours: number; open_case_count: number; unissued_correction_count?: number; identity_review_count?: number; uncategorized_entry_count?: number; retained_uncategorized_line_count?: number; receipt_review_count?: number
}
export interface EvidenceEntry {
  id: string; version: number; work_date: string; start_time: string | null; end_time: string | null; description: string | null; category: string | null
  approval_status: string | null; overtime_status: string; status: string; regular_hours: number; overtime_hours: number
  worked_hours: number; eligible_hours: number; pending_hours: number; denied_hours: number; issued_hours: number; committed_hours: number; exported_hours: number; held_hours: number; needs_reconciliation_hours: number; payment_attestation: string | null
}
export interface CoverageLine {
  id: string; batch_id?: string; source_time_entry_id: string; source_user_id?: string; source_kind: string; source_line_key?: string; source_category_id?: number | null; work_date: string
  regular_hours: number | null; overtime_hours: number | null; total_hours: number; status: string; coverage_state: string
  external_pay_period_id?: string | null; external_payroll_item_id?: string | null; payment_reference?: string | null; payment_method?: string | null; reason?: string | null
  destination_start_date?: string; destination_end_date?: string; payment_effective_on?: string | null
  identity_state?: string; receipt_scope?: string; actual_check_components: null; provenance: string
}
export interface EvidencePeriod {
  id: string; start_date: string; end_date: string; summary: EvidenceTotals; review_required: boolean
  actual_check_components: null; amount_owed: null; entries?: EvidenceEntry[]; coverage_lines?: CoverageLine[]
  detail_pagination?: { per_page: number; offset: number; counts: { entries: number; coverage_lines: number; settlement_cases: number }; next_cursor: string | null }
  settlement_cases?: { public_id: string; source_time_entry_id: number; status: string; origin_reason: string; destination_kind: string; target_external_pay_period_id: string | null; held_total_hours: string; action_due_on: string }[]
}
export interface EmployeeEvidence {
  integration: { source_instance_id: string }; contract_version: string; as_of: string; evidence_note: string
  employee: { id: string; payroll_integration_id: string; full_name: string; active: boolean; time_tracking_enabled: boolean }
  periods: EvidencePeriod[]; totals: EvidenceTotals; pagination: { per_page: number; total_count: number; next_cursor: string | null }
}

async function read<T>(endpoint: string, signal?: AbortSignal): Promise<T> {
  const token = await getAuthTokenValue()
  const response = await fetch(apiUrl(endpoint), { signal, headers: token ? { Authorization: `Bearer ${token}` } : {} })
  const data = await response.json().catch(() => null)
  if (!response.ok || !data) throw new Error(data?.error || `Unable to load employee evidence (${response.status}). Please retry.`)
  return data as T
}

function identityChecked<T>(data: T, valid: boolean): T {
  if (!valid) throw new Error('Related records do not match this employee. Reload before continuing.')
  return data
}

export const employeeEvidenceApi = {
  schedule: (id: string, week: string, signal?: AbortSignal) => read<{ schedules: Schedule[] }>(`/api/v1/schedules?${new URLSearchParams({ user_id: id, week })}`, signal).then((data) => identityChecked(data, Array.isArray(data.schedules) && data.schedules.every((record) => String(record?.user_id) === id))),
  activity: (id: string, page: number, signal?: AbortSignal) => read<{ audit_logs: AuditLogEntry[]; pagination: { total_pages: number } }>(`/api/v1/admin/audit_logs?${new URLSearchParams({ subject_type: 'User', subject_id: id, page: String(page), per_page: '20' })}`, signal).then((data) => identityChecked(data, Array.isArray(data.audit_logs) && data.audit_logs.every((record) => record?.subject?.type === 'User' && String(record.subject.id) === id))),
  user: (id: string, signal?: AbortSignal) => read<{ user: AdminUser }>(`/api/v1/admin/users/${encodeURIComponent(id)}`, signal),
  periods: (id: string, query: URLSearchParams, signal?: AbortSignal) => read<EmployeeEvidence>(`/api/v1/admin/users/${encodeURIComponent(id)}/periods?${query}`, signal),
  period: (id: string, periodId: string, query: URLSearchParams, signal?: AbortSignal) => read<{ period: EvidencePeriod; as_of: string; employee: EmployeeEvidence['employee']; integration: EmployeeEvidence['integration'] }>(`/api/v1/admin/users/${encodeURIComponent(id)}/periods/${encodeURIComponent(periodId)}?${query}`, signal),
}
