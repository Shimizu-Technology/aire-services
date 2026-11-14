import { ADMIN_PATHS } from '../../lib/adminRoutes'
import { withPayrollPeriod } from '../../lib/payrollPeriods'
import type { ClockAttentionItem } from '../../lib/api/attention'

// Where each Today action goes. The Approvals inbox reads `kind`, `period` and
// `user_id`; Timecards reads `entry_id`, `date` and `user_id`.

const withQuery = (path: string, query: Record<string, string | number | undefined>) => {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) if (value !== undefined) params.set(key, String(value))
  const search = params.toString()
  return search ? `${path}?${search}` : path
}

/** One person's open clock on Timecards, where Fix clock-out lives. */
export const openClockHref = (item: ClockAttentionItem) =>
  withQuery(ADMIN_PATHS.timecards, { entry_id: item.entry_id, date: item.work_date, user_id: item.user.id })

/** The first shift with no work category; Timecards finds its owner and pay period. */
export const missingCategoryHref = (entryId: number | undefined) =>
  withQuery(ADMIN_PATHS.timecards, { entry_id: entryId })

export const approvalsHref = (query: { kind?: string; period?: string; user_id?: number } = {}) =>
  withQuery(ADMIN_PATHS.approvals, query)

export const payrollHref = (period?: { start_date: string; end_date: string } | null) =>
  period ? withPayrollPeriod(ADMIN_PATHS.payroll, { start: period.start_date, end: period.end_date }) : ADMIN_PATHS.payroll

export const PAYROLL_CONNECTION_HREF = '/admin/settings/payroll-connection'
