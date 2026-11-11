import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { CalendarPlus, CircleCheckBig, type LucideIcon } from 'lucide-react'

import { ADMIN_PATHS } from '../../lib/adminRoutes'
import { withPayrollPeriod, type PayrollPeriod } from '../../lib/payrollPeriods'

export type TimePayrollSection = 'entries' | 'approvals' | 'reports' | 'payroll' | 'leave'

interface TimePayrollWorkspaceHeaderProps {
  activeSection: TimePayrollSection
  /** Owners, admins and managers: approvals, team timecards and hours reports. */
  canManageTeamTime: boolean
  /** Owners and admins: the payroll workspace. Kept for callers; Payroll is its own page now. */
  canManagePayroll?: boolean
  /** Supervisors approve leave, so Leave sits beside Approvals for them. */
  canApproveLeave?: boolean
  pendingApprovalCount?: number
  pendingOvertimeCount?: number
  period?: PayrollPeriod
  action?: ReactNode
}

// Each section used to be a tab on one "Time & Payroll" page. They are
// separate pages in the navigation now, so this header names the page and,
// for supervisors, links time approvals and leave approvals to each other.
function titleFor(section: TimePayrollSection, canManageTeamTime: boolean) {
  if (section === 'approvals') return 'Approvals'
  if (section === 'reports') return 'Reports'
  if (section === 'payroll') return 'Payroll'
  if (section === 'leave') return canManageTeamTime ? 'Approvals' : 'Leave'
  return canManageTeamTime ? 'Timecards' : 'My Hours'
}

function descriptionFor(section: TimePayrollSection, canManageTeamTime: boolean) {
  if (section === 'approvals') return 'Approve, correct or deny the team’s time and overtime before each cutoff.'
  if (section === 'reports') return 'Live hours by person, category and source, with PDF and CSV exports.'
  if (section === 'payroll') return 'What each cutoff sends to payroll, and the cutoffs already finalized.'
  if (section === 'leave') return canManageTeamTime ? 'Review time-off requests, or request your own.' : 'Request time off and see the status of your requests.'
  return canManageTeamTime
    ? 'Find and fix anyone’s recorded time, or log missed time.'
    : 'Your recorded shifts and hours.'
}

function approvalBadge(count: number) {
  return count > 99 ? '99+' : String(count)
}

interface SubSection {
  id: 'approvals' | 'leave'
  label: string
  icon: LucideIcon
}

const approvalSections: SubSection[] = [
  { id: 'approvals', label: 'Time & overtime', icon: CircleCheckBig },
  { id: 'leave', label: 'Leave requests', icon: CalendarPlus },
]

export default function TimePayrollWorkspaceHeader({
  activeSection,
  canManageTeamTime,
  canApproveLeave = canManageTeamTime,
  pendingApprovalCount = 0,
  pendingOvertimeCount = 0,
  period,
  action,
}: TimePayrollWorkspaceHeaderProps) {
  const showApprovalTabs = canManageTeamTime && canApproveLeave && (activeSection === 'approvals' || activeSection === 'leave')

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-950">{titleFor(activeSection, canManageTeamTime)}</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">{descriptionFor(activeSection, canManageTeamTime)}</p>
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </header>

      {showApprovalTabs && (
        <div className="border-b border-slate-200">
          <nav aria-label="Approval types" className="-mb-px flex gap-5 overflow-x-auto pb-px [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {approvalSections.map((section) => {
              const active = activeSection === section.id
              const Icon = section.icon
              const showCount = section.id === 'approvals' && pendingApprovalCount > 0
              const href = section.id === 'approvals'
                ? (period ? withPayrollPeriod(ADMIN_PATHS.approvals, period, { through_date: period.end }) : ADMIN_PATHS.approvals)
                : ADMIN_PATHS.leave
              return (
                <Link
                  key={section.id}
                  to={href}
                  aria-label={showCount ? `${section.label}, ${pendingApprovalCount} pending` : section.label}
                  aria-current={active ? 'page' : undefined}
                  className={`inline-flex min-h-11 shrink-0 items-center gap-2 border-b-2 px-1 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${
                    active
                      ? 'border-primary text-primary'
                      : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-900'
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" strokeWidth={1.9} aria-hidden="true" />
                  <span>{section.label}</span>
                  {showCount && (
                    <span
                      className="inline-flex h-5 min-w-5 items-center justify-center rounded-full border border-amber-200 bg-amber-50 px-1.5 text-xs font-bold leading-none text-amber-700"
                      title={`${pendingApprovalCount} pending approval${pendingApprovalCount === 1 ? '' : 's'}${pendingOvertimeCount > 0 ? ` · ${pendingOvertimeCount} overtime` : ''}`}
                    >
                      {approvalBadge(pendingApprovalCount)}
                    </span>
                  )}
                </Link>
              )
            })}
          </nav>
        </div>
      )}
    </div>
  )
}
