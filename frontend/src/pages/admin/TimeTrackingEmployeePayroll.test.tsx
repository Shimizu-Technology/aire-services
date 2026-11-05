import '@testing-library/jest-dom'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import TimeTracking from './TimeTracking'
import type { EmployeePayrollStatus } from '../../lib/api'

const apiMock = vi.hoisted(() => ({
  getTimeEntries: vi.fn(), getTimeCategories: vi.fn(), getUsers: vi.fn(), getCurrentUser: vi.fn(), getSchedule: vi.fn(),
}))
vi.mock('../../lib/api', () => ({ api: apiMock }))
vi.mock('../../contexts/AuthContext', () => ({
  useAuthContext: () => ({ isClerkEnabled: true, userRole: 'employee', currentUser: { id: 7 }, isSignedIn: true }),
}))
vi.mock('../../components/time-tracking/PayrollCutoffNotice', () => ({ default: () => null }))
vi.mock('../../components/time-tracking/ClockInOutCard', () => ({ default: () => null }))
vi.mock('../../components/time-tracking/LeaveRequestsPanel', () => ({ default: () => null }))

function fixture(payroll_status?: EmployeePayrollStatus) {
  return {
    id: 1, work_date: '2025-05-06', hours: 8, start_time: '08:00', end_time: '16:00',
    formatted_start_time: '8:00 AM', formatted_end_time: '4:00 PM', break_minutes: 0,
    description: 'Practice shift', entry_method: 'clock', status: 'completed', approval_status: 'approved',
    overtime_status: 'none', user: { id: 7, full_name: 'Test Employee' }, time_category: { id: 3, name: 'Training' },
    payroll_status,
  }
}

function open(view: 'day' | 'week', status?: EmployeePayrollStatus) {
  apiMock.getTimeEntries.mockResolvedValue({ data: { time_entries: [fixture(status)] } })
  render(<MemoryRouter initialEntries={[`/admin/time?date=2025-05-06&view=${view}`]}><TimeTracking /></MemoryRouter>)
}

const states: Array<[EmployeePayrollStatus['status'], string, number, number]> = [
  ['awaiting_approval', 'Not in payroll — awaiting approval', 0, 0],
  ['not_payable', 'Not in payroll — time denied', 0, 0],
  ['ready_for_cutoff', 'Approved — not paid yet', 0, 0],
  ['finalized', 'In payroll — not paid yet', 0, 0],
  ['imported', 'In payroll — not paid yet', 0, 0],
  ['committed', 'In payroll — not paid yet', 0, 0],
  ['payment_prepared', 'Check prepared — not paid yet', 0, 0],
  ['payment_issued', 'Paid', 8, 0],
  ['payment_cancelled', 'Payment cancelled', 0, 0],
  ['payment_voided', 'Payment voided', 0, 0],
  ['payment_failed', 'Payment needs attention', 0, 0],
  ['partially_paid', 'Partly paid', 6, 2],
  ['partially_prepared', 'Partly prepared — not fully paid', 0, 0],
  ['partially_processed', 'Partly in payroll — not paid yet', 0, 0],
  ['partially_allocated', 'Partly in payroll — not paid yet', 0, 0],
  ['held', 'On hold — awaiting payroll', 0, 8],
  ['payment_attested_pending_evidence', 'On hold — payment confirmation pending', 0, 8],
  ['payment_history_unavailable', 'Payment history unavailable', 0, 0],
]

describe('My Time employee payment status', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    apiMock.getTimeCategories.mockResolvedValue({ data: { time_categories: [] } })
    apiMock.getUsers.mockResolvedValue({ error: 'Admin access required', status: 403 })
    apiMock.getCurrentUser.mockResolvedValue({ data: { user: { id: 7, is_admin: false, time_category_ids: [] } } })
    apiMock.getSchedule.mockResolvedValue({ data: { schedules: [] } })
  })

  describe.each(['day', 'week'] as const)('%s list', (view) => {
    it.each(states)('displays %s and its safe source-hour quantities', async (status, label, paid, held) => {
      open(view, { status, label, paid_hours: paid, held_hours: held })
      const panel = await screen.findByLabelText('Payroll payment status')
      expect(within(panel).getByText(label, { exact: true })).toBeVisible()
      expect(within(panel).getByText(`Paid hours: ${paid.toFixed(2)}h`)).toBeVisible()
      if (held) expect(within(panel).getByText(`Hours on hold: ${held.toFixed(2)}h`)).toBeVisible()
      else expect(within(panel).queryByText(/Hours on hold/)).not.toBeInTheDocument()
      if (status !== 'payment_issued') expect(within(panel).queryByText('Paid', { exact: true })).not.toBeInTheDocument()
      // Employee week uses the same wrapping cards as day, with dates visible.
      if (view === 'week') expect(screen.getByText('Tue, May 6')).toBeVisible()
    })
  })

  it('never infers paid from approval when the status response is missing', async () => {
    open('day')
    const panel = await screen.findByLabelText('Payroll payment status')
    expect(within(panel).getByText('Payment status unavailable')).toBeVisible()
    expect(within(panel).queryByText('Paid', { exact: true })).not.toBeInTheDocument()
  })

  it('keeps status visible when switching between employee week and day', async () => {
    open('week', { status: 'payment_prepared', label: 'Check prepared — not paid yet', paid_hours: 0, held_hours: 0 })
    expect(await screen.findByText('Check prepared — not paid yet')).toBeVisible()
    fireEvent.click(screen.getAllByRole('button', { name: 'Day' })[0])
    expect(await screen.findByText('Check prepared — not paid yet')).toBeVisible()
  })
})
