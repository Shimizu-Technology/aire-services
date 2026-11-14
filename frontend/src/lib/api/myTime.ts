import { api } from '../api'
import type { LeaveRequest, TimeEntry } from '../api'
import { timecardsApi } from './timecards'
import type { PayPeriod } from '../payPeriods'

// Every employee write targets the authenticated viewer. There is no person
// selector and no caller-supplied user_id on these writes.
export const myTimeApi = {
  status: () => api.getClockStatus(),
  categories: () => api.getTimeCategories(),
  people: () => api.getUsers(),
  entries: (viewerId: number, period: PayPeriod) =>
    timecardsApi.personEntries(viewerId, period),
  clockIn: (categoryId: number, location?: Parameters<typeof api.clockIn>[3]) =>
    api.clockIn(undefined, undefined, categoryId, location),
  clockOut: () => api.clockOut(),
  startBreak: () => api.startBreak(),
  endBreak: () => api.endBreak(),
  switchWork: (categoryId: number) => api.switchCategory(categoryId),
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
        ...change,
        expected_version: entry.version,
        description: [change.description, `Requested fix: ${reason}`]
          .filter(Boolean)
          .join('\n'),
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
      if (!result.data) return { error: result.error || "Couldn't load your requests." }
      requests.push(
        ...result.data.leave_requests.filter((row) => row.user.id === viewerId),
      )
      if (page >= result.data.pagination.total_pages) return { data: requests }
    }
    return { error: 'Too many requests to load. Ask Chels for help.' }
  },
  requestLeave: (request: Parameters<typeof api.createLeaveRequest>[0]) =>
    api.createLeaveRequest(request),
  cancelLeave: (id: number) => api.cancelLeaveRequest(id),
}
