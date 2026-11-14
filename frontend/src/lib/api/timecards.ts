import { api } from '../api'
import type { HoursReportDay, HoursReportEmployee, HoursReportParams, HoursReportResponse, TimeEntry } from '../api'
import { addDateDays } from '../dateUtils'
import type { PayPeriod } from '../payPeriods'

// Timecards' reads and writes. Every call goes through the shared `api`
// client; this module only shapes the parameters the page needs.

/** A person's hours report row without its per-entry rows (`summary_only=1`). */
export type TimecardSummaryEmployee = Omit<HoursReportEmployee, 'days' | 'excluded_entries'> & {
  days: Array<Omit<HoursReportDay, 'entries'>>
  /**
   * Hours left out of total_hours that are still waiting (for approval, or
   * held for an overtime review). total_hours + waiting_hours is every hour
   * worked in the period. Absent from an API older than this field.
   */
  waiting_hours?: number
}

export type TimecardSummaryResponse = Omit<HoursReportResponse, 'employees'> & {
  summary_only: true
  employees: TimecardSummaryEmployee[]
}

type Result<T> = { data?: T; error?: string; status?: number; code?: string }

/**
 * True when a write's outcome is unknown: no answer reached us (network error,
 * timeout), the answer wasn't the API's own, or the server failed (a 5xx, such
 * as a 502 while a deploy restarts it, can arrive after the write committed).
 * Only a real API refusal means nothing was saved.
 */
export function outcomeUnknown(response: { error?: string; status?: number }) {
  if (!response.status || response.status >= 500) return true
  return /^Server returned an (invalid|empty) response/.test(response.error ?? '')
}

// The API caps a page at 500 rows; a person's pay period is far smaller, and a
// team week needs a few pages at most. Past the limit it's an error, never a
// partial list whose totals look complete.
const PAGE_SIZE = 200
const MAX_PAGES = 10

async function allEntries(params: Parameters<typeof api.getTimeEntries>[0]): Promise<Result<TimeEntry[]>> {
  const entries: TimeEntry[] = []
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const response = await api.getTimeEntries({ ...params, page, per_page: PAGE_SIZE })
    if (!response.data) return { error: response.error || "Couldn't load the shifts.", status: response.status }
    entries.push(...response.data.time_entries)
    const totalPages = response.data.pagination?.total_pages ?? 1
    if (totalPages > MAX_PAGES) return { error: `There are more than ${MAX_PAGES * PAGE_SIZE} shifts here, too many to show at once.` }
    if (page >= totalPages) break
  }
  return { data: entries }
}

function summaryReport(period: PayPeriod, userId?: number): Promise<Result<TimecardSummaryResponse>> {
  // include_empty lists everyone who tracks time, even with nothing logged yet.
  const query: HoursReportParams & { summary_only: 1 } = {
    start_date: period.start,
    end_date: period.end,
    include_empty: true,
    summary_only: 1,
    ...(userId ? { user_id: userId } : {}),
  }
  return api.getHoursReport(query) as Promise<Result<TimecardSummaryResponse>>
}

export const timecardsApi = {
  /**
   * Every shift one person has in a pay period, plus the day before it, whose
   * overnight shifts can run into the period's first day.
   */
  personEntries: (userId: number, period: PayPeriod) =>
    allEntries({ user_id: userId, start_date: addDateDays(period.start, -1), end_date: period.end }),

  /** Everyone's shifts for the Sunday-to-Saturday week starting `weekStart`. */
  teamWeek: (weekStart: string) => allEntries({ week: weekStart }),

  /** Hours and flags per person for the people list. */
  peopleSummary: (period: PayPeriod) => summaryReport(period),

  /**
   * One person's full report row for the period: each shift with its
   * allocated overtime, and the shifts left out of the totals (waiting,
   * denied, held for an overtime review). `payPeriodHours` reads it.
   */
  personReport: (userId: number, period: PayPeriod) =>
    api.getHoursReport({ start_date: period.start, end_date: period.end, include_empty: true, user_id: userId }),

  /**
   * Ends an open clock at the time they actually left. The API's end_clock
   * correction keeps the breaks, sends the shift back for approval and records
   * the reason in the audit log. Starting the reason with "Corrected clock-out"
   * is what lists it in Approvals as a corrected clock-out.
   */
  fixClockOut: (entry: Pick<TimeEntry, 'id' | 'version'>, change: { stopDate: string; endTime: string; timeCategoryId: number; reason: string }) => {
    const reason = change.reason.trim()
    return api.updateTimeEntry(entry.id, {
      review_action: 'end_clock',
      expected_version: entry.version,
      stop_date: change.stopDate,
      end_time: change.endTime,
      time_category_id: change.timeCategoryId,
    }, /^corrected clock-out\b/i.test(reason) ? reason : `Corrected clock-out: ${reason}`)
  },

  /** Adds a shift someone forgot to clock. It always waits for approval. */
  logMissedTime: (shift: { userId: number; workDate: string; startTime: string; endTime: string; breakMinutes: number | null; timeCategoryId: number; note: string }) =>
    api.createTimeEntry({
      user_id: shift.userId,
      work_date: shift.workDate,
      start_time: shift.startTime,
      end_time: shift.endTime,
      break_minutes: shift.breakMinutes,
      time_category_id: shift.timeCategoryId,
      description: shift.note.trim() || undefined,
    }),

  entry: (id: number) => api.getTimeEntry(id),
  users: () => api.getUsers(),
  whosWorking: () => api.getWhosWorking(),
  categories: () => api.getTimeCategories(),
  cutoff: () => api.getPayrollCutoff(),
  schedule: (id: number) => api.getSchedule(id),
}
