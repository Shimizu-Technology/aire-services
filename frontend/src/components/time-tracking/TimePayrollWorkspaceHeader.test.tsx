import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import TimePayrollWorkspaceHeader from './TimePayrollWorkspaceHeader'

function renderHeader(props: Parameters<typeof TimePayrollWorkspaceHeader>[0]) {
  return render(<MemoryRouter><TimePayrollWorkspaceHeader {...props} /></MemoryRouter>)
}

describe('TimePayrollWorkspaceHeader', () => {
  it('names each section after its page in the navigation', () => {
    const { rerender } = renderHeader({ activeSection: 'payroll', canManageTeamTime: true, canManagePayroll: true })
    expect(screen.getByRole('heading', { name: 'Payroll' })).toBeInTheDocument()
    // The sidebar links these pages now; the header no longer repeats them as tabs.
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()

    rerender(<MemoryRouter><TimePayrollWorkspaceHeader activeSection="reports" canManageTeamTime /></MemoryRouter>)
    expect(screen.getByRole('heading', { name: 'Reports' })).toBeInTheDocument()
    rerender(<MemoryRouter><TimePayrollWorkspaceHeader activeSection="entries" canManageTeamTime /></MemoryRouter>)
    expect(screen.getByRole('heading', { name: 'Timecards' })).toBeInTheDocument()
    rerender(<MemoryRouter><TimePayrollWorkspaceHeader activeSection="entries" canManageTeamTime={false} /></MemoryRouter>)
    expect(screen.getByRole('heading', { name: 'My Hours' })).toBeInTheDocument()
  })

  it('links time approvals and leave approvals for supervisors, keeping the period', () => {
    renderHeader({
      activeSection: 'approvals',
      canManageTeamTime: true,
      pendingApprovalCount: 35,
      pendingOvertimeCount: 1,
      period: { start: '2026-08-16', end: '2026-08-31' },
    })

    const types = screen.getByRole('navigation', { name: 'Approval types' })
    expect(screen.getByRole('heading', { name: 'Approvals' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Time & overtime, 35 pending' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Time & overtime, 35 pending' })).toHaveAttribute(
      'href',
      '/admin/approvals?start_date=2026-08-16&end_date=2026-08-31&through_date=2026-08-31',
    )
    expect(screen.getByRole('link', { name: 'Leave requests' })).toHaveAttribute('href', '/admin/leave')
    expect(types).toContainElement(screen.getByRole('link', { name: 'Leave requests' }))
  })

  it('shows employees their own Leave page without the approval tabs', () => {
    renderHeader({ activeSection: 'leave', canManageTeamTime: false })
    expect(screen.getByRole('heading', { name: 'Leave' })).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Approval types' })).not.toBeInTheDocument()
  })

  it('keeps leave under Approvals for supervisors', () => {
    renderHeader({ activeSection: 'leave', canManageTeamTime: true })
    expect(screen.getByRole('heading', { name: 'Approvals' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Leave requests' })).toHaveAttribute('aria-current', 'page')
  })
})
