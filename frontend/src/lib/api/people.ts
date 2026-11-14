import { api, fetchApi } from '../api'
import type { AdminUser, LeaveRequest } from '../api'
import type { HandoffState } from '../payrollTerms'

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

// Two pay periods a month, so 24 is the last year.
const PAY_PERIOD_LIMIT = 24
// Leave isn't filtered by person on the server, so read a generous page of each.
const LEAVE_PAGE = 100

export const peopleApi = {
  /** The person record. A 404 means there's no such person. */
  person: (id: number) => fetchApi<{ user: AdminUser }>(`/api/v1/admin/users/${id}`),

  /** The most recent published pay periods, newest first. */
  payPeriods: () =>
    fetchApi<{ periods: PayPeriodState[]; current_start_date: string | null }>(`/api/v1/payroll_periods?limit=${PAY_PERIOD_LIMIT}`),

  /**
   * One person's waiting and approved leave that hasn't ended yet, soonest
   * first. Reads the most recent requests, which covers anything upcoming.
   */
  upcomingLeave: async (userId: number, today: string): Promise<Result<LeaveRequest[]>> => {
    const [pending, approved] = await Promise.all([
      api.getLeaveRequests('pending', 1, LEAVE_PAGE),
      api.getLeaveRequests('approved', 1, LEAVE_PAGE),
    ])
    if (!pending.data || !approved.data) return { error: pending.error || approved.error || "Couldn't load leave.", status: pending.status ?? approved.status }
    const requests = [...pending.data.leave_requests, ...approved.data.leave_requests]
      .filter(request => request.user.id === userId && request.end_date >= today)
      .sort((a, b) => a.start_date.localeCompare(b.start_date))
    return { data: requests }
  },
}
