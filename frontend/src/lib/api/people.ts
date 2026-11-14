import { api, fetchApi, getAuthTokenValue } from '../api'
import type { AdminUser, LeaveRequest } from '../api'
import type { HandoffState } from '../payrollTerms'
import { apiUrl } from '../apiBase'

// The person page's reads beyond the person record itself. Hours and payroll
// evidence come from `employeeEvidenceApi`, shifts from `timecardsApi`; this
// module adds the pay period states and the person's leave.

/** A published pay period and where it is in the hand-off (GET /payroll_periods). */
export interface PayPeriodState {
  id: number
  start_date: string
  end_date: string
  pay_date: string
  status: string
  handoff_state: HandoffState
  locked_at: string | null
}

type Result<T> = { data?: T; error?: string; status?: number }

// Leave isn't filtered by person on the server, so read whole lists. The API
// caps a page at 100; past the page limit it's an error, not a partial list.
const LEAVE_PAGE = 100
const LEAVE_MAX_PAGES = 50

async function allLeave(status: 'pending' | 'approved'): Promise<Result<LeaveRequest[]>> {
  const requests: LeaveRequest[] = []
  for (let page = 1; page <= LEAVE_MAX_PAGES; page += 1) {
    const response = await api.getLeaveRequests(status, page, LEAVE_PAGE)
    if (!response.data) return { error: response.error || "Couldn't load leave.", status: response.status }
    requests.push(...response.data.leave_requests)
    const totalPages = response.data.pagination?.total_pages ?? 1
    if (totalPages > LEAVE_MAX_PAGES) return { error: `There are more than ${LEAVE_MAX_PAGES * LEAVE_PAGE} leave requests, too many to read at once.` }
    if (page >= totalPages) return { data: requests }
  }
  return { data: requests }
}

export interface PersonEdit {
  admin_edit_version: number
  role?: AdminUser['role']
  email?: string | null
  first_name?: string
  last_name?: string
  personal_access_enabled?: boolean
  send_invitation?: boolean
  my_pay_enabled?: boolean
  staff_title?: string | null
  approval_groups?: string[]
  time_tracking_enabled?: boolean
  time_category_ids?: number[]
  is_intern?: boolean
  public_team_enabled?: boolean
  public_team_name?: string | null
  public_team_title?: string | null
  public_team_bio?: string | null
  public_team_sort_order?: number
  public_team_photo_position_x?: number
  public_team_photo_position_y?: number
  remove_photo?: boolean
}

export interface TerminationPreview {
  admin_edit_version: number
  waiting_shifts: number
  waiting_hours: number
  waiting_overtime_hours: number
  open_clock: boolean
  open_pay_stub_links: number
  open_pay_stub_requests: number
  open_leave_requests: number
}

export type PersonSaved = { user: AdminUser; kiosk_pin?: string | null; invitation_email_captured?: boolean; invitation_email_sent?: boolean }

export const peopleApi = {
  setMyPay: (id: number, enabled: boolean, version: number) => fetchApi<{ user_id: number; my_pay_enabled: boolean; admin_edit_version: number }>(`/api/v1/admin/users/${id}/my_pay`, {
    method: 'PATCH', body: JSON.stringify({ enabled, admin_edit_version: version }),
  }),
  save: async (id: number, edit: PersonEdit, photo?: File | null): Promise<Result<PersonSaved>> => {
    if (!photo) return fetchApi<PersonSaved>(`/api/v1/admin/users/${id}`, { method: 'PATCH', body: JSON.stringify(edit) })
    // api.ts is frozen; its JSON helper always sets Content-Type. Multipart
    // must let the browser choose the boundary, with the same auth getter.
    try {
      const form = new FormData()
      form.append('person_edit', JSON.stringify(edit))
      form.append('photo', photo)
      const token = await getAuthTokenValue()
      const response = await fetch(apiUrl(`/api/v1/admin/users/${id}`), {
        method: 'PATCH', body: form, headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      const data = await response.json()
      return response.ok ? { data, status: response.status } : { error: data.error || "Couldn't save this person.", status: response.status }
    } catch {
      return { error: "Couldn't save this person. Check your connection and try again." }
    }
  },
  terminationPreview: (id: number) => fetchApi<{ preview: TerminationPreview }>(`/api/v1/admin/users/${id}/termination_preview`),
  terminate: (id: number, data: { admin_edit_version: number; effective_on: string; confirm_name: string; reason?: string }) =>
    fetchApi<PersonSaved>(`/api/v1/admin/users/${id}/terminate`, { method: 'POST', body: JSON.stringify(data) }),
  reactivate: (id: number, version: number) => fetchApi<PersonSaved>(`/api/v1/admin/users/${id}/reactivate`, {
    method: 'POST', body: JSON.stringify({ admin_edit_version: version }),
  }),
  /** The person record. A 404 means there's no such person. */
  person: (id: number) => fetchApi<{ user: AdminUser }>(`/api/v1/admin/users/${id}`),

  /**
   * Where one pay period is in payroll, or null when it was never published
   * (no lock was scheduled for it). Throws when the status couldn't be read.
   */
  payPeriod: async (startDate: string): Promise<PayPeriodState | null> => {
    const response = await fetchApi<{ period: PayPeriodState }>(`/api/v1/payroll_periods/${encodeURIComponent(startDate)}`)
    if (response.data?.period) return response.data.period
    if (response.status === 404) return null
    throw new Error(response.error || "Couldn't load this period's payroll status.")
  },

  /**
   * One person's waiting and approved leave that hasn't ended yet, soonest
   * first. The API doesn't filter by person, so this reads every page of both
   * lists; if any page fails the whole answer is an error, never a short list.
   */
  upcomingLeave: async (userId: number, today: string): Promise<Result<LeaveRequest[]>> => {
    const [pending, approved] = await Promise.all([allLeave('pending'), allLeave('approved')])
    if (!pending.data || !approved.data) return { error: pending.error || approved.error || "Couldn't load leave.", status: pending.status ?? approved.status }
    const requests = [...pending.data, ...approved.data]
      .filter(request => request.user.id === userId && request.end_date >= today)
      .sort((a, b) => a.start_date.localeCompare(b.start_date))
    return { data: requests }
  },
}
