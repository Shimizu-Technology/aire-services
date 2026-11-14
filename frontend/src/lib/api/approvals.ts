import {
  fetchApi,
  type ApprovalReason,
  type PendingApprovalsParams,
  type TimeEntry,
  type LeaveRequest,
  type PaginationMeta,
} from '../api'

export type ReviewEntry = TimeEntry & {
  version: number
  review_kind: 'ordinary' | 'needs_look'
  exceptions: ApprovalReason[]
}
export interface ReviewSummary {
  complete: boolean
  ordinary_count: number
  ordinary_hours: number
  needs_look_count: number
  batch_limit: number
  ordinary_max_shift_hours?: number
  by_person: {
    user_id: number
    full_name: string
    ordinary_count: number
    ordinary_hours: number
    needs_look_count: number
  }[]
}
export interface ApprovalsResponse {
  pending_entries: ReviewEntry[]
  count: number
  review_summary: ReviewSummary
  pagination: { current_page: number; total_pages: number; total_count: number }
}
export interface ReviewItem {
  id: number
  version: number
  approve_time: boolean
  approve_overtime: boolean
  overtime_hours?: number
}
export interface ReviewBatch {
  review_batch_id: string
  undo_expires_at: string
  approved_count: number
  time_entries: { id: number; version: number; approval_status: string; overtime_status: string }[]
}
export interface HistoryChange {
  action: string
  at: string
  actor: { id: number | null; full_name: string } | null
  sentence: string
  reason: string | null
  fields: {
    field: string
    label: string
    before: string | number | boolean | null
    after: string | number | boolean | null
  }[]
}
export const approvalsApi = {
  entry: (id: number) => fetchApi<{ time_entry: TimeEntry }>(`/api/v1/time_entries/${id}`),
  approvedLeave: (start: string, end: string, page: number) => {
    const query = new URLSearchParams({
      status: 'approved',
      start_date: start,
      end_date: end,
      page: String(page),
      per_page: '100',
    })
    return fetchApi<{ leave_requests: LeaveRequest[]; pagination: PaginationMeta }>(
      `/api/v1/leave_requests?${query}`,
    )
  },
  pending: (params: PendingApprovalsParams) => {
    const query = new URLSearchParams()
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== '') query.set(key, String(value))
    })
    return fetchApi<ApprovalsResponse>(`/api/v1/time_entries/pending_approvals?${query}`)
  },
  review: (items: readonly ReviewItem[], key: string, mode: 'ordinary' | 'reviewed' = 'ordinary') =>
    fetchApi<ReviewBatch>('/api/v1/time_entries/review_batch', {
      method: 'POST',
      headers: { 'Idempotency-Key': key },
      body: JSON.stringify({ items, mode }),
    }),
  undo: (id: string) =>
    fetchApi<{ undone_count: number }>(
      `/api/v1/time_entries/review_batches/${encodeURIComponent(id)}/undo`,
      { method: 'POST' },
    ),
  history: (id: number) =>
    fetchApi<{ entry_id: number; changes: HistoryChange[] }>(
      `/api/v1/time_entries/${id}/review_history`,
    ),
}
