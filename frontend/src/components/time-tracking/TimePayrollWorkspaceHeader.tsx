import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { CalendarPlus, ChartNoAxesColumnIncreasing, CircleCheckBig, Clock3, ReceiptText, type LucideIcon } from 'lucide-react'

import { withPayrollPeriod, type PayrollPeriod } from '../../lib/payrollPeriods'

export type TimePayrollSection = 'entries' | 'approvals' | 'reports' | 'payroll' | 'leave'

interface TimePayrollWorkspaceHeaderProps {
  activeSection: TimePayrollSection
  isAdmin: boolean
  pendingApprovalCount?: number
  pendingOvertimeCount?: number
  period?: PayrollPeriod
  action?: ReactNode
  onSectionChange?: (section: Exclude<TimePayrollSection, 'payroll'>) => void
}

interface WorkspaceSection {
  id: TimePayrollSection
  label: string
  icon: LucideIcon
  adminOnly?: boolean
}

const sections: WorkspaceSection[] = [
  { id: 'entries', label: 'Time Entries', icon: Clock3 },
  { id: 'approvals', label: 'Approvals', icon: CircleCheckBig, adminOnly: true },
  { id: 'reports', label: 'Hours Reports', icon: ChartNoAxesColumnIncreasing, adminOnly: true },
  { id: 'payroll', label: 'Payroll', icon: ReceiptText, adminOnly: true },
  { id: 'leave', label: 'Leave Requests', icon: CalendarPlus },
]

function sectionHref(section: TimePayrollSection, period?: PayrollPeriod) {
  if (section === 'payroll') return period ? withPayrollPeriod('/admin/payroll', period) : '/admin/payroll'
  if (section === 'entries') return '/admin/time'
  if (section === 'leave') return '/admin/time?tab=leave'
  if (section === 'approvals' && period) {
    return withPayrollPeriod('/admin/time', period, { tab: 'approvals', through_date: period.end })
  }
  return period
    ? withPayrollPeriod('/admin/time', period, { tab: section })
    : `/admin/time?tab=${section}`
}

function approvalBadge(count: number) {
  return count > 99 ? '99+' : String(count)
}

export default function TimePayrollWorkspaceHeader({
  activeSection,
  isAdmin,
  pendingApprovalCount = 0,
  pendingOvertimeCount = 0,
  period,
  action,
  onSectionChange,
}: TimePayrollWorkspaceHeaderProps) {
  const visibleSections = sections.filter((section) => isAdmin || !section.adminOnly)

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-cyan-700">
            {isAdmin ? 'Workforce operations' : 'Staff workspace'}
          </p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">
            {isAdmin ? 'Time & Payroll' : 'My Time'}
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
            {isAdmin
              ? 'Review recorded time, resolve approvals, inspect live hours, and finalize auditable payroll cutoffs.'
              : 'Clock in, review your recorded hours, and manage leave requests.'}
          </p>
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </header>

      <div className="border-b border-slate-200">
        <nav aria-label="Time and payroll sections" className="-mb-px flex gap-5 overflow-x-auto pb-px [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {visibleSections.map((section) => {
            const active = activeSection === section.id
            const Icon = section.icon
            const label = section.id === 'approvals' && pendingApprovalCount > 0
              ? `Approvals, ${pendingApprovalCount} pending`
              : section.label
            const content = (
              <>
                <Icon className="h-4 w-4 shrink-0" strokeWidth={1.9} aria-hidden="true" />
                <span>{section.label}</span>
                {section.id === 'approvals' && pendingApprovalCount > 0 && (
                  <span
                    className="inline-flex h-5 min-w-5 items-center justify-center rounded-full border border-amber-200 bg-amber-50 px-1.5 text-[11px] font-bold leading-none text-amber-700"
                    title={`${pendingApprovalCount} pending approval${pendingApprovalCount === 1 ? '' : 's'}${pendingOvertimeCount > 0 ? ` · ${pendingOvertimeCount} overtime` : ''}`}
                  >
                    {approvalBadge(pendingApprovalCount)}
                  </span>
                )}
              </>
            )
            const className = `inline-flex min-h-11 shrink-0 items-center gap-2 border-b-2 px-1 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 focus-visible:ring-offset-2 ${
              active
                ? 'border-cyan-700 text-cyan-800'
                : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-900'
            }`

            if (onSectionChange && section.id !== 'payroll') {
              const timeSection = section.id
              return (
                <button
                  key={section.id}
                  type="button"
                  onClick={() => onSectionChange(timeSection)}
                  aria-label={label}
                  aria-pressed={active}
                  className={className}
                >
                  {content}
                </button>
              )
            }

            return (
              <Link
                key={section.id}
                to={sectionHref(section.id, period)}
                aria-label={label}
                aria-current={active ? 'page' : undefined}
                className={className}
              >
                {content}
              </Link>
            )
          })}
        </nav>
      </div>
    </div>
  )
}
