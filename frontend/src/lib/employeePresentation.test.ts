import { describe, expect, it } from 'vitest'
import { shift } from '../test/employeeFixtures'
import {
  employeeDate,
  employeeDateRange,
  employeeShiftStatus,
} from './employeePresentation'
import type { EmployeePayrollStatus } from './api'

describe('one employee status', () => {
  it.each([
    [
      'pending',
      'payment_history_unavailable',
      'Payment status not tracked yet',
      'Waiting for approval',
    ],
    [
      'approved',
      'payment_history_unavailable',
      'Approved — payment status not tracked yet',
      'Approved — not paid yet',
    ],
    ['approved', 'finalized', 'In payroll — not paid yet', 'In payroll — not paid yet'],
    ['approved', 'payment_issued', 'Paid', 'Paid'],
    [
      'pending',
      'awaiting_approval',
      'Not in payroll — awaiting approval',
      'Waiting for approval',
    ],
    [
      'denied',
      'not_payable',
      'Not in payroll — time denied',
      'Not in payroll — time denied',
    ],
  ] as const)('%s / %s shows %s as one status', (approval, status, label, expected) => {
    expect(
      employeeShiftStatus(
        shift({
          approval_status: approval,
          payroll_status: {
            status: status as EmployeePayrollStatus['status'],
            label,
            paid_hours: 0,
            held_hours: 0,
          },
        }),
      ).label,
    ).toBe(expected)
  })
  it('uses approval when no payroll status exists', () => {
    expect(employeeShiftStatus(shift()).label).toBe('Waiting for approval')
    expect(employeeShiftStatus(shift({ approval_status: 'approved' })).label).toBe(
      'Approved — not paid yet',
    )
  })
})

describe('employee dates', () => {
  const today = '2026-11-14'
  it.each([
    ['2026-12-04', '2026-12-04', 'Dec 4'],
    ['2026-11-20', '2026-11-21', 'Nov 20–21'],
    ['2025-11-20', '2025-11-21', 'Nov 20–21, 2025'],
    ['2026-11-30', '2026-12-02', 'Nov 30–Dec 2'],
    ['2025-12-31', '2026-01-02', 'Dec 31, 2025–Jan 2'],
  ])('formats %s to %s', (start, end, expected) => {
    expect(employeeDateRange(start, end, today)).toBe(expected)
  })
  it('keeps a year on older shift and paycheck dates', () => {
    expect(employeeDate('2025-11-04', { weekday: 'short' }, today)).toBe(
      'Tue, Nov 4, 2025',
    )
  })
})
