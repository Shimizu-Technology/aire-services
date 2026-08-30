import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import TimePayrollWorkspaceHeader from './TimePayrollWorkspaceHeader'

describe('TimePayrollWorkspaceHeader', () => {
  it('connects admin time, reports, approvals, and payroll with one period', () => {
    render(
      <MemoryRouter>
        <TimePayrollWorkspaceHeader
          activeSection="payroll"
          isAdmin
          pendingApprovalCount={35}
          pendingOvertimeCount={1}
          period={{ start: '2026-08-16', end: '2026-08-31' }}
        />
      </MemoryRouter>,
    )

    expect(screen.getByRole('heading', { name: 'Time & Payroll' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Payroll' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Approvals, 35 pending' })).toHaveAttribute(
      'href',
      '/admin/time?start_date=2026-08-16&end_date=2026-08-31&tab=approvals&through_date=2026-08-31',
    )
    expect(screen.getByRole('link', { name: 'Hours Reports' })).toHaveAttribute(
      'href',
      '/admin/time?start_date=2026-08-16&end_date=2026-08-31&tab=reports',
    )
  })

  it('keeps payroll and admin review tools out of the staff workspace', () => {
    const onSectionChange = vi.fn()
    render(
      <MemoryRouter>
        <TimePayrollWorkspaceHeader activeSection="entries" isAdmin={false} onSectionChange={onSectionChange} />
      </MemoryRouter>,
    )

    expect(screen.getByRole('heading', { name: 'My Time' })).toBeInTheDocument()
    expect(screen.queryByText('Payroll')).not.toBeInTheDocument()
    expect(screen.queryByText('Hours Reports')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Leave Requests' }))
    expect(onSectionChange).toHaveBeenCalledWith('leave')
  })
})
