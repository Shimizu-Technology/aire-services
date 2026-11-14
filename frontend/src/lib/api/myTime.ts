import { api, fetchApi } from '../api'
import type { ClockStatus, LeaveRequest, TimeEntry } from '../api'
import { timecardsApi } from './timecards'
import type { PayPeriod } from '../payPeriods'

// Abort the transport and settle even if an auth/provider promise never returns.
// A timeout has no HTTP status and must be reconciled as an unknown outcome.
async function boundedRequest<T>(
  endpoint: string,
  options: RequestInit,
  timeoutMessage: string,
): Promise<{ data?: T; error?: string; status?: number }> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<{ error: string }>((resolve) => {
    timer = setTimeout(() => {
      controller.abort()
      resolve({ error: timeoutMessage })
    }, 20_000)
  })
  try {
    return await Promise.race([
      fetchApi<T>(endpoint, { ...options, signal: controller.signal }),
      timeout,
    ])
  } finally {
    clearTimeout(timer)
  }
}

function clockRequest<T>(endpoint: string, body?: object) {
  return boundedRequest<T>(
    `/api/v1/time_entries/${endpoint}`,
    {
      method: endpoint === 'current_status' ? 'GET' : 'POST',
      ...(body ? { body: JSON.stringify(body) } : {}),
    },
    'The clock request timed out. Check your clock status.',
  )
}

// Every employee write targets the authenticated viewer. There is no person
// selector and no caller-supplied user_id on these writes.
export const myTimeApi = {
  status: () => clockRequest<ClockStatus>('current_status'),
  categories: () => api.getTimeCategories(),
  people: () => api.getUsers(),
  entries: (viewerId: number, period: PayPeriod) =>
    timecardsApi.personEntries(viewerId, period),
  entry: (id: number) =>
    boundedRequest<{ time_entry: TimeEntry }>(
      `/api/v1/time_entries/${id}`,
      { method: 'GET', cache: 'no-store' },
      'The shift check timed out. Nothing was sent. Try again.',
    ),
  clockIn: (categoryId: number, location?: Parameters<typeof api.clockIn>[3]) =>
    clockRequest<{ time_entry: TimeEntry }>('clock_in', {
      time_category_id: categoryId,
      ...(location ? { location } : {}),
    }),
  clockOut: () => clockRequest<{ time_entry: TimeEntry }>('clock_out'),
  startBreak: () => clockRequest<{ time_entry: TimeEntry }>('start_break'),
  endBreak: () => clockRequest<{ time_entry: TimeEntry }>('end_break'),
  switchWork: (categoryId: number) =>
    clockRequest<{ time_entry: TimeEntry }>('switch_category', {
      time_category_id: categoryId,
    }),
  askForFix: (
    entry: TimeEntry,
    change: {
      start_time: string
      end_time: string
      break_minutes: number | null
      time_category_id: number
      description: string
      breaks?: Array<{ id?: number; start_time: string; end_time: string }>
    },
    reason: string,
  ) =>
    api.updateTimeEntry(
      entry.id,
      {
        ...(change.start_time !== entry.start_time
          ? { start_time: change.start_time }
          : {}),
        ...(change.end_time !== entry.end_time
          ? { end_time: change.end_time }
          : {}),
        ...((change.break_minutes ?? 0) !== (entry.break_minutes ?? 0)
          ? { break_minutes: change.break_minutes }
          : {}),
        ...(change.time_category_id !== entry.time_category?.id
          ? { time_category_id: change.time_category_id }
          : {}),
        ...(change.breaks &&
        JSON.stringify(change.breaks) !==
          JSON.stringify(
            entry.breaks.map((row) => ({
              id: row.id,
              start_time: row.start_time,
              end_time: row.end_time,
            })),
          )
          ? { breaks: change.breaks }
          : {}),
        ...(change.description !== (entry.description ?? '')
          ? { description: change.description }
          : {}),
      },
      reason,
    ),
  addTime: (shift: Parameters<typeof api.createTimeEntry>[0]) => {
    const {
      work_date,
      start_time,
      end_time,
      time_category_id,
      break_minutes,
      description,
    } = shift
    return api.createTimeEntry({
      work_date,
      start_time,
      end_time,
      time_category_id,
      break_minutes,
      description,
    })
  },
  leave: async (viewerId: number) => {
    const requests: LeaveRequest[] = []
    for (let page = 1; page <= 20; page += 1) {
      const result = await api.getLeaveRequests(undefined, page, 100)
      if (!result.data)
        return { error: result.error || "Couldn't load your requests." }
      requests.push(
        ...result.data.leave_requests.filter((row) => row.user.id === viewerId),
      )
      if (page >= result.data.pagination.total_pages) return { data: requests }
    }
    return { error: 'Too many requests to load. Ask Chels for help.' }
  },
  requestLeave: (request: Parameters<typeof api.createLeaveRequest>[0]) =>
    boundedRequest<{ leave_request: LeaveRequest }>(
      '/api/v1/leave_requests',
      {
        method: 'POST',
        body: JSON.stringify({ leave_request: request }),
      },
      'The leave request timed out. Check your requests before trying again.',
    ),
  cancelLeave: (id: number) =>
    boundedRequest<{ leave_request: LeaveRequest }>(
      `/api/v1/leave_requests/${id}/cancel`,
      {
        method: 'POST',
      },
      'The cancellation timed out. Check your requests before trying again.',
    ),
}
