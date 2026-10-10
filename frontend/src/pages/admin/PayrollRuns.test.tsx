import '@testing-library/jest-dom'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useNavigate } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import PayrollRuns from './PayrollRuns'

const apiMock = vi.hoisted(() => ({
  getPayrollBatches: vi.fn(),
  getPayrollCarryovers: vi.fn(),
  getPayrollBatch: vi.fn(),
  previewPayrollBatch: vi.fn(),
  finalizePayrollBatch: vi.fn(),
  downloadPayrollBatch: vi.fn(),
}))

vi.mock('../../lib/api', () => ({ api: apiMock }))

const issues = {
  missing_category_count: 0,
  negative_adjustment_count: 0,
  pending_approval_count: 1,
  denied_approval_count: 0,
  open_clock_count: 0,
  pending_overtime_count: 0,
  denied_overtime_count: 0,
}

const preview = {
  schema_version: '2.0',
  source: 'aire_services',
  batch_id: 'PREVIEW',
  start_date: '2026-08-16',
  end_date: '2026-08-31',
  cutoff_at: '2026-08-31T01:00:00Z',
  generated_at: '2026-08-31T01:00:00Z',
  preview: true,
  can_finalize: true,
  requires_negative_adjustment_acknowledgement: false,
  issues,
  summary: {
    employee_count: 1,
    adjustment_count: 1,
    total_hours: 8,
    regular_hours: 8,
    overtime_hours: 0,
    current_count: 1,
    carryover_count: 0,
    correction_count: 0,
    exclusion_count: 1,
  },
  employees: [{
    source_user_id: '7',
    email: 'alice@example.com',
    display_name: 'Alice Pilot',
    total_hours: 8,
    regular_hours: 8,
    overtime_hours: 0,
    adjustments: [{
      source_time_entry_id: '51',
      line_key: 'category:3',
      source_kind: 'current',
      original_work_date: '2026-08-20',
      original_week_start: '2026-08-16',
      source_category_id: '3',
      category: { id: 3, key: 'flight', name: 'Flight Hours' },
      total_hours: 8,
      regular_hours: 8,
      overtime_hours: 0,
    }],
  }],
  exclusions: [{
    source_time_entry_id: '52',
    source_user_id: '7',
    display_name: 'Alice Pilot',
    email: 'alice@example.com',
    category: { id: 3, key: 'flight', name: 'Flight Hours' },
    reason: 'pending_approval',
    original_work_date: '2026-08-21',
    held_total_hours: 4,
    held_regular_hours: 4,
    held_overtime_hours: 0,
    first_excluded_batch_id: 'PREVIEW',
  }],
}

const finalized = {
  id: 'AIRE-PAY-20260831-ABC123',
  start_date: preview.start_date,
  end_date: preview.end_date,
  cutoff_at: preview.cutoff_at,
  finalized_at: preview.cutoff_at,
  finalized_by: { id: 1, name: 'Admin User' },
  checksum: 'a'.repeat(64),
  processing: null,
  summary: preview.summary,
  issues,
  payload: {
    ...preview,
    preview: undefined,
    can_finalize: undefined,
    export: {
      id: 'AIRE-PAY-20260831-ABC123',
      batch_id: 'AIRE-PAY-20260831-ABC123',
      checksum: 'a'.repeat(64),
      checksum_algorithm: 'SHA-256',
      checksum_scope: 'payload_without_export',
      readiness_status: 'finalized',
      cutoff_at: preview.cutoff_at,
      finalized_at: preview.cutoff_at,
    },
  },
}

function renderPayrollRuns(initialEntry = '/admin/payroll') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <PayrollRuns />
    </MemoryRouter>,
  )
}

function PayrollRouteHarness() {
  const navigate = useNavigate()
  return (
    <>
      <button type="button" onClick={() => navigate('/admin/payroll?start_date=2026-07-01&end_date=2026-07-15')}>Open July payroll</button>
      <PayrollRuns />
    </>
  )
}

describe('PayrollRuns', () => {
  beforeEach(() => {
    Object.values(apiMock).forEach((mock) => mock.mockReset())
    apiMock.getPayrollBatches.mockResolvedValue({ data: { payroll_batches: [], total_count: 0, truncated: false } })
    apiMock.getPayrollCarryovers.mockResolvedValue({ data: {
      items: [],
      summary: { awaiting_approval_count: 0, ready_for_next_batch_count: 0, in_payroll_count: 0, not_payable_count: 0 },
      truncated: false,
    } })
    apiMock.previewPayrollBatch.mockResolvedValue({ data: preview })
    apiMock.finalizePayrollBatch.mockResolvedValue({ data: finalized })
    apiMock.getPayrollBatch.mockResolvedValue({ data: finalized })
  })

  it.each(['scheduled', 'failed', 'finalized'])('guides a %s published calendar preview without offering competing manual actions', async (status) => {
    apiMock.previewPayrollBatch.mockResolvedValue({ data: { ...preview, can_finalize: false,
      finalization_blocked_reason: 'This range overlaps a published payroll calendar. Use its Lock action in Cornerstone Payroll.',
      published_calendar_periods: [{ external_pay_period_id: 'published-run', start_date: preview.start_date,
        end_date: preview.end_date, cutoff_at: preview.cutoff_at, status,
        payroll_batch_id: status === 'finalized' ? finalized.id : null }],
    } })
    renderPayrollRuns()
    fireEvent.click(screen.getByRole('button', { name: 'Preview cutoff' }))
    expect(await screen.findByRole('region', { name: 'Published payroll calendar' })).toHaveTextContent('published-run')
    expect(screen.getByRole('region', { name: 'Published payroll calendar' })).toHaveTextContent('Lock')
    expect(screen.queryByRole('button', { name: 'Finalize this cutoff' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Record already processed' })).not.toBeInTheDocument()
    expect(screen.queryByText('Finalization is blocked until every included entry has a work category.')).not.toBeInTheDocument()
    expect(apiMock.finalizePayrollBatch).not.toHaveBeenCalled()
    if (status === 'finalized') {
      fireEvent.click(screen.getByRole('button', { name: 'View published batch' }))
      await waitFor(() => expect(apiMock.getPayrollBatch).toHaveBeenCalledWith(finalized.id))
    }
  })

  it('blocks historical recording if a calendar is published after the dialog was opened', async () => {
    apiMock.previewPayrollBatch.mockResolvedValueOnce({ data: preview }).mockResolvedValueOnce({ data: { ...preview,
      cutoff_at: '2026-08-31T03:06:00.000Z', can_finalize: false,
      published_calendar_periods: [{ external_pay_period_id: 'newly-published', start_date: preview.start_date,
        end_date: preview.end_date, cutoff_at: preview.cutoff_at, status: 'scheduled' }],
    } })
    renderPayrollRuns()
    fireEvent.click(screen.getByRole('button', { name: 'Preview cutoff' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Record already processed' }))
    fireEvent.change(screen.getByLabelText(/Hours frozen at/), { target: { value: '2026-08-31T13:06' } })
    fireEvent.change(screen.getByLabelText(/Cornerstone processed at/), { target: { value: '2026-08-31T13:18' } })
    fireEvent.change(screen.getByLabelText('Cornerstone pay period ID'), { target: { value: 'matching-period' } })
    fireEvent.change(screen.getByLabelText(/Reconciliation note/), { target: { value: 'Compared historical source facts' } })
    fireEvent.click(screen.getByRole('button', { name: 'Review historical snapshot' }))
    expect(await screen.findByRole('region', { name: 'Published payroll calendar' })).toHaveTextContent('newly-published')
    fireEvent.click(screen.getByRole('checkbox', { name: /I compared this historical AIRE snapshot/ }))
    expect(screen.getByRole('button', { name: 'Record as processed manually' })).toBeDisabled()
    expect(apiMock.finalizePayrollBatch).not.toHaveBeenCalled()
  })

  it('previews included hours separately from tracked exclusions', async () => {
    renderPayrollRuns()
    await screen.findByText('No payroll batches have been finalized yet.')

    fireEvent.click(screen.getByRole('button', { name: 'Preview cutoff' }))

    expect(await screen.findByText('Alice Pilot')).toBeInTheDocument()
    expect(screen.getByText('Pending approval', { selector: 'p' })).toBeInTheDocument()
    expect(screen.getAllByText('8.00 hrs', { selector: 'p' }).length).toBeGreaterThan(0)
    expect(screen.getByText(/Pending and open work stays attached/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '1 Pending approval' })).toHaveAttribute(
      'href',
      '/admin/time?start_date=2026-08-16&end_date=2026-08-31&tab=approvals&through_date=2026-08-31',
    )
  })

  it('loads an exact linked frozen batch outside the history list and retains the return path', async () => {
    renderPayrollRuns(`/admin/payroll?batch_id=${finalized.id}&user_id=7&entry_id=51&return_to=%2Fadmin%2Fusers%2F7%3Ftab%3Dhours`)
    expect(await screen.findByText('Alice Pilot')).toBeInTheDocument()
    expect(apiMock.getPayrollBatch).toHaveBeenCalledWith(finalized.id)
    expect(screen.getByLabelText('Linked frozen time entry')).toHaveTextContent('8.00 hrs')
    expect(screen.getByRole('link', { name: 'Back to employee review' })).toHaveAttribute('href', '/admin/users/7?tab=hours')
    expect(screen.getByText(/Batch totals above include everyone/)).toBeInTheDocument()
  })

  it('rejects a different batch returned for an exact link', async () => {
    apiMock.getPayrollBatch.mockResolvedValue({ data: finalized })
    renderPayrollRuns('/admin/payroll?batch_id=wrong-batch')
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be loaded')
    expect(screen.queryByText('Alice Pilot')).not.toBeInTheDocument()
  })

  it('shows late-approved time and Cornerstone processing state in the carryover queue', async () => {
    apiMock.getPayrollCarryovers.mockResolvedValue({ data: {
      items: [{
        source_time_entry_id: '52',
        source_user_id: '7',
        display_name: 'Alice Pilot',
        email: 'alice@example.com',
        category: { id: 3, key: 'flight', name: 'Flight Hours' },
        original_work_date: '2026-08-21',
        first_excluded_batch_id: 'AIRE-PAY-OLD',
        latest_excluded_batch_id: 'AIRE-PAY-OLD',
        exclusion_reason: 'pending_approval',
        held_total_hours: 4,
        current_total_hours: 4,
        status: 'ready_for_next_batch',
        included_batch: null,
      }],
      summary: { awaiting_approval_count: 0, ready_for_next_batch_count: 1, in_payroll_count: 0, not_payable_count: 0 },
      truncated: false,
    } })

    renderPayrollRuns()

    expect(await screen.findByText('Ready for next cutoff')).toBeInTheDocument()
    expect(screen.getByText(/AIRE will include it automatically/)).toBeInTheDocument()
  })

  it('distinguishes historical review from recorded manual payments', async () => {
    const common = {
      source_user_id: '7', email: 'alice@example.com', category: null,
      original_work_date: '2026-05-04', first_excluded_batch_id: 'AIRE-PAY-OLD',
      latest_excluded_batch_id: 'AIRE-PAY-OLD', exclusion_reason: 'denied_overtime',
      held_total_hours: 1, current_total_hours: 9, included_batch: null,
    }
    apiMock.getPayrollCarryovers.mockResolvedValue({ data: {
      items: [
        { ...common, source_time_entry_id: '91', display_name: 'Historical review', status: 'needs_review' },
        { ...common, source_time_entry_id: '92', display_name: 'Manual payment recorded', status: 'payment_issued',
          payroll_lifecycle: { status: 'payment_issued', manually_paid_hours: 9,
            settlements: [{ batch_id: 'manual-1', status: 'payment_issued', total_hours: 9 }] } },
        { ...common, source_time_entry_id: '93', display_name: 'Partial manual payment', status: 'partially_paid',
          payroll_lifecycle: { status: 'partially_paid', manually_paid_hours: 8,
            settlements: [{ batch_id: 'manual-2', status: 'payment_issued', total_hours: 8 }] } },
      ],
      summary: { awaiting_approval_count: 0, ready_for_next_batch_count: 0, needs_review_count: 1, in_payroll_count: 2, not_payable_count: 0 },
      truncated: false,
    } })
    renderPayrollRuns()
    expect(await screen.findByText('Historical review')).toBeInTheDocument()
    expect(screen.getByText(/choose a payroll destination in Cornerstone/)).toBeInTheDocument()
    expect(screen.getByText(/will not be included automatically/)).toBeInTheDocument()
    expect(screen.queryByText(/AIRE will include it automatically/)).not.toBeInTheDocument()
    expect(screen.getByText('Paid', { selector: 'span' })).toBeInTheDocument()
    expect(screen.getByText('9.00 hrs paid · 0.00 hrs outstanding')).toBeInTheDocument()
    expect(screen.getByText('8.00 hrs paid · 1.00 hrs outstanding')).toBeInTheDocument()
  })

  it('separates validated paid and accounting history from unfinished carryovers without losing cards', async () => {
    const common = {
      source_user_id: '7', email: null, category: null, original_work_date: '2026-05-04',
      first_excluded_batch_id: 'AIRE-PAY-OLD', latest_excluded_batch_id: 'AIRE-PAY-OLD',
      exclusion_reason: 'pending_overtime', held_total_hours: 2, current_total_hours: 10, included_batch: null,
    }
    apiMock.getPayrollCarryovers.mockResolvedValue({ data: {
      items: [
        { ...common, source_time_entry_id: '81', display_name: 'Completed OT worker', status: 'payment_issued', completion: 'paid' },
        { ...common, source_time_entry_id: '82', display_name: 'Signed accounting worker', status: 'committed', completion: 'accounting_recorded',
          payroll_lifecycle: { status: 'committed', accounting_only: true, settlements: [] } },
        { ...common, source_time_entry_id: '83', display_name: 'Unverified receipt worker', status: 'payment_issued', completion: null,
          payroll_lifecycle: { status: 'payment_issued', settlements: [{ batch_id: 'reported', status: 'payment_issued', total_hours: 10 }] } },
      ],
      summary: { awaiting_approval_count: 0, ready_for_next_batch_count: 0, in_payroll_count: 1, not_payable_count: 0,
        unresolved_count: 1, paid_count: 1, accounting_recorded_count: 1 }, truncated: false,
    } })
    renderPayrollRuns()
    await screen.findByText('Completed OT worker')
    const queue = screen.getByRole('region', { name: 'Carryover queue' })
    expect(queue).toHaveTextContent('1 active item')
    const history = within(queue).getByRole('region', { name: 'Recorded history' })
    expect(history).toHaveTextContent('Completed OT worker')
    expect(history).toHaveTextContent('Signed accounting worker')
    expect(history).not.toHaveTextContent('Unverified receipt worker')
    expect(within(screen.getByText('Completed OT worker').closest('article')!).getByText('Paid', { selector: 'span' })).toBeInTheDocument()
    const accounting = screen.getByText('Signed accounting worker').closest('article')!
    expect(accounting).toHaveTextContent('Accounting correction committed')
    expect(accounting).not.toHaveTextContent('hrs paid')
    expect(screen.getByText('Unverified receipt worker').closest('article')).toHaveTextContent('Needs payroll review')
    expect(screen.getByText('Unverified receipt worker').closest('article')).not.toHaveTextContent('hrs paid')
    expect(queue).toHaveTextContent('Paid records')
    expect(queue).toHaveTextContent('Accounting records')
  })

  it('shows zero active items with completed history still available', async () => {
    apiMock.getPayrollCarryovers.mockResolvedValue({ data: {
      items: [{ source_time_entry_id: '84', source_user_id: '7', display_name: 'Retained paid worker', email: null, category: null,
        original_work_date: '2026-05-04', first_excluded_batch_id: 'old', latest_excluded_batch_id: 'old',
        exclusion_reason: 'denied_approval', held_total_hours: 4, current_total_hours: 4, status: 'payment_issued', completion: 'paid', included_batch: null }],
      summary: { awaiting_approval_count: 0, ready_for_next_batch_count: 0, in_payroll_count: 0, not_payable_count: 0,
        unresolved_count: 0, paid_count: 1, accounting_recorded_count: 0 }, truncated: false,
    } })
    renderPayrollRuns()
    await screen.findByText('Retained paid worker')
    expect(screen.getByRole('region', { name: 'Carryover queue' })).toHaveTextContent('0 active items')
    expect(screen.getByText('No unpaid carryover items need attention.')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Recorded history' })).toHaveTextContent('Retained paid worker')
  })

  it('does not claim no unfinished work when completed visible history is truncated', async () => {
    apiMock.getPayrollCarryovers.mockResolvedValue({ data: {
      items: [{ source_time_entry_id: '85', source_user_id: '7', display_name: 'Visible paid record', email: null, category: null,
        original_work_date: '2026-05-04', first_excluded_batch_id: 'old', latest_excluded_batch_id: 'old',
        exclusion_reason: 'pending_approval', held_total_hours: 4, current_total_hours: 4, status: 'payment_issued', completion: 'paid', included_batch: null }],
      summary: { awaiting_approval_count: 0, ready_for_next_batch_count: 0, in_payroll_count: 1, not_payable_count: 0,
        unresolved_count: 1, paid_count: 250, accounting_recorded_count: 0 }, truncated: true,
    } })
    renderPayrollRuns()
    await screen.findByText('Visible paid record')
    expect(screen.getByRole('region', { name: 'Carryover queue' })).toHaveTextContent('1 active item')
    expect(screen.queryByText('No unpaid carryover items need attention.')).not.toBeInTheDocument()
    expect(screen.getByText(/Showing the first 250 carryover records/)).toBeInTheDocument()
  })

  it('explains a supplemental destination without promising automatic regular inclusion', async () => {
    apiMock.getPayrollCarryovers.mockResolvedValue({ data: {
      items: [{
        source_time_entry_id: '94', source_user_id: '7', display_name: 'Supplemental worker',
        email: null, category: null, original_work_date: '2026-05-04',
        first_excluded_batch_id: 'AIRE-PAY-OLD', latest_excluded_batch_id: 'AIRE-PAY-OLD',
        exclusion_reason: 'denied_overtime', held_total_hours: 1, current_total_hours: 9,
        status: 'scheduled_supplemental', included_batch: null,
      }],
      summary: { awaiting_approval_count: 0, ready_for_next_batch_count: 0, in_payroll_count: 1, not_payable_count: 0 },
      truncated: false,
    } })
    renderPayrollRuns()
    expect(await screen.findByText('Scheduled for supplemental payroll')).toBeInTheDocument()
    expect(screen.getByText(/Complete that run and record its payment/)).toBeInTheDocument()
    expect(screen.queryByText('Ready for next cutoff')).not.toBeInTheDocument()
    expect(screen.queryByText(/AIRE will include it automatically/)).not.toBeInTheDocument()
  })

  it.each([
    ['awaiting_approval', 'Needs approval'],
    ['needs_review', 'Needs payroll review'],
    ['ready_for_next_batch', 'Ready for next cutoff'],
    ['scheduled_supplemental', 'Scheduled for supplemental payroll'],
    ['payment_issued', 'Paid'],
    ['committed', 'Payroll committed'],
    ['partially_allocated', 'Partially assigned to payroll'],
    ['partially_paid', 'Partially paid'],
    ['payment_attested_pending_evidence', 'Payment reported; evidence pending'],
    ['not_payable', null],
  ])('uses the current %s projection for a historical denied approval card', async (status, label) => {
    const common = {
      source_user_id: '7', email: null, category: null, original_work_date: '2026-05-04',
      first_excluded_batch_id: 'AIRE-PAY-OLD', latest_excluded_batch_id: 'AIRE-PAY-OLD',
      held_total_hours: 4, current_total_hours: 4, included_batch: null,
    }
    apiMock.getPayrollCarryovers.mockResolvedValue({ data: {
      items: [
        { ...common, source_time_entry_id: '3', display_name: 'Formerly denied worker', exclusion_reason: 'denied_approval', status },
        { ...common, source_time_entry_id: '4', display_name: 'Other carryover worker', exclusion_reason: 'pending_approval', status: 'awaiting_approval' },
      ],
      summary: { awaiting_approval_count: status === 'awaiting_approval' ? 2 : 1,
        ready_for_next_batch_count: status === 'ready_for_next_batch' ? 1 : 0,
        needs_review_count: status === 'needs_review' ? 1 : 0,
        in_payroll_count: ['scheduled_supplemental', 'payment_issued', 'committed', 'partially_paid', 'partially_allocated', 'payment_attested_pending_evidence'].includes(status) ? 1 : 0,
        not_payable_count: status === 'not_payable' ? 1 : 0 },
      truncated: false,
    } })
    renderPayrollRuns()
    await screen.findByText('Other carryover worker')
    const queue = screen.getByRole('region', { name: 'Carryover queue' })
    if (label) {
      const card = screen.getByText('Formerly denied worker').closest('article')!
      expect(within(card).getByText(label, { selector: 'span' })).toBeInTheDocument()
      expect(within(card).getByText('Originally excluded: Denied')).toBeInTheDocument()
      expect(queue).toHaveTextContent('2 active items')
      if (status === 'needs_review' || status === 'scheduled_supplemental') {
        expect(card).toHaveTextContent('will not be included automatically')
        expect(card).not.toHaveTextContent('AIRE will include it automatically')
      }
    } else {
      expect(screen.queryByText('Formerly denied worker')).not.toBeInTheDocument()
      expect(queue).toHaveTextContent('1 active item')
      expect(queue).toHaveTextContent('Closed unpaid')
    }
    expect(apiMock.finalizePayrollBatch).not.toHaveBeenCalled()
  })

  it('keeps a retained closed-unpaid decision in history while valid pending time remains active', async () => {
    const common = { source_user_id: '7', email: null, category: null, original_work_date: '2026-11-01',
      first_excluded_batch_id: 'AIRE-OLD', latest_excluded_batch_id: 'AIRE-OLD', exclusion_reason: 'pending_approval', included_batch: null }
    apiMock.getPayrollCarryovers.mockResolvedValue({ data: {
      items: [
        { ...common, source_time_entry_id: '1', display_name: 'Invalid training record', status: 'not_payable', held_total_hours: 1, current_total_hours: 1,
          payroll_lifecycle: { status: 'awaiting_approval', label: 'Awaiting approval', settlements: [] },
          settlement_case: { id: 'case-invalid', status: 'not_payable', destination_kind: 'not_payable', resolution_note: 'Duplicate training input; no wages owed',
            decision: { event_id: 'decision-1', event_type: 'marked_not_payable', occurred_at: '2026-11-02T07:00:00Z',
              reason: 'Duplicate training input; no wages owed', actor: { name: 'Synthetic Reviewer' } } } },
        { ...common, source_time_entry_id: '2', display_name: 'Valid pending worker', status: 'awaiting_approval', held_total_hours: 4, current_total_hours: 4 },
      ], summary: { awaiting_approval_count: 1, ready_for_next_batch_count: 0, in_payroll_count: 0, not_payable_count: 1,
        unresolved_count: 1, paid_count: 0, accounting_recorded_count: 0 }, truncated: false,
    } })
    renderPayrollRuns()
    await screen.findByText('Valid pending worker')
    const history = screen.getByRole('region', { name: 'Recorded history' })
    expect(history).toHaveTextContent('Invalid training record')
    expect(history).toHaveTextContent('Closed unpaid')
    expect(history).toHaveTextContent('1.00 hrs')
    expect(history).toHaveTextContent('Duplicate training input; no wages owed')
    expect(history).toHaveTextContent('Synthetic Reviewer')
    expect(within(history).getByText(/Nov 2, 2026/)).toBeInTheDocument()
    expect(history).toHaveTextContent('0.00 hrs paid')
    expect(history).not.toHaveTextContent('outstanding')
    expect(history).not.toHaveTextContent('Valid pending worker')
    expect(screen.getByRole('region', { name: 'Carryover queue' })).toHaveTextContent('1 active item')
    expect(apiMock.finalizePayrollBatch).not.toHaveBeenCalled()
  })

  it('does not erase prior paid evidence when displaying an unpaid closure', async () => {
    apiMock.getPayrollCarryovers.mockResolvedValue({ data: {
      items: [{ source_time_entry_id: '1', source_user_id: '7', display_name: 'Retained evidence worker', email: null,
        category: null, original_work_date: '2026-11-01', first_excluded_batch_id: 'AIRE-OLD', latest_excluded_batch_id: 'AIRE-OLD',
        exclusion_reason: 'pending_approval', included_batch: null, status: 'not_payable', held_total_hours: 1, current_total_hours: 1,
        settlement_case: { id: 'case-invalid', status: 'not_payable', destination_kind: 'not_payable', resolution_note: 'The held input is invalid' },
        payroll_lifecycle: { status: 'payment_issued', label: 'Paid', settlements: [{ status: 'payment_issued', total_hours: 2, paid_hours: 2 }] },
      }], summary: { awaiting_approval_count: 0, ready_for_next_batch_count: 0, in_payroll_count: 0,
        not_payable_count: 1, unresolved_count: 0, paid_count: 0 }, truncated: false,
    } })
    renderPayrollRuns()
    const history = await screen.findByRole('region', { name: 'Recorded history' })
    expect(history).toHaveTextContent('2.00 hrs paid in retained payment evidence')
    expect(history).not.toHaveTextContent('0.00 hrs paid')
    expect(history).toHaveTextContent('This decision records no payment')
  })

  it('keeps all four routed workers visible when one was originally denied approval', async () => {
    apiMock.getPayrollCarryovers.mockResolvedValue({ data: {
      items: ['First', 'Second', 'Formerly denied', 'Fourth'].map((name, index) => ({
        source_time_entry_id: String(index + 1), source_user_id: String(index + 1), display_name: `${name} worker`,
        email: null, category: null, original_work_date: '2026-05-04',
        first_excluded_batch_id: 'AIRE-PAY-OLD', latest_excluded_batch_id: 'AIRE-PAY-OLD',
        exclusion_reason: index === 2 ? 'denied_approval' : 'pending_approval',
        held_total_hours: 4, current_total_hours: 4, status: 'ready_for_next_batch', included_batch: null,
      })),
      summary: { awaiting_approval_count: 0, ready_for_next_batch_count: 4, in_payroll_count: 0, not_payable_count: 0 },
      truncated: false,
    } })
    renderPayrollRuns()
    expect(await screen.findByText('Formerly denied worker')).toBeInTheDocument()
    const queue = screen.getByRole('region', { name: 'Carryover queue' })
    expect(within(queue).getAllByRole('article')).toHaveLength(4)
    expect(queue).toHaveTextContent('4 active items')
    expect(within(queue).getAllByText('Ready for next cutoff', { selector: 'span' })).toHaveLength(4)
  })

  it('explains post-cutoff edits and deletions in plain language', async () => {
    apiMock.getPayrollCarryovers.mockResolvedValue({ data: {
      items: [
        {
          source_time_entry_id: '61',
          source_user_id: '7',
          display_name: 'Alice Pilot',
          email: 'alice@example.com',
          category: { id: 3, key: 'flight', name: 'Flight Hours' },
          original_work_date: '2026-08-20',
          first_excluded_batch_id: 'AIRE-PAY-OLD',
          latest_excluded_batch_id: 'AIRE-PAY-OLD',
          exclusion_reason: 'changed_after_cutoff',
          held_total_hours: 4,
          current_total_hours: 4,
          status: 'ready_for_next_batch',
          included_batch: null,
        },
        {
          source_time_entry_id: '62',
          source_user_id: '8',
          display_name: 'Ben Mechanic',
          email: 'ben@example.com',
          category: { id: 4, key: 'maintenance', name: 'Maintenance' },
          original_work_date: '2026-08-21',
          first_excluded_batch_id: 'AIRE-PAY-OLD',
          latest_excluded_batch_id: 'AIRE-PAY-OLD',
          exclusion_reason: 'deleted_after_cutoff',
          held_total_hours: 8,
          current_total_hours: 0,
          status: 'ready_for_next_batch',
          included_batch: null,
        },
      ],
      summary: { awaiting_approval_count: 0, ready_for_next_batch_count: 2, in_payroll_count: 0, not_payable_count: 0 },
      truncated: false,
    } })

    renderPayrollRuns()

    expect(await screen.findByText('Originally excluded: Edited after cutoff')).toBeInTheDocument()
    expect(screen.getByText('Originally excluded: Deleted after cutoff')).toBeInTheDocument()
  })

  it('shows exact paid and outstanding hours for a partially paid carryover entry', async () => {
    apiMock.getPayrollCarryovers.mockResolvedValue({ data: {
      items: [{
        source_time_entry_id: '52',
        source_user_id: '7',
        display_name: 'Alice Pilot',
        email: 'alice@example.com',
        category: { id: 3, key: 'flight', name: 'Flight Hours' },
        original_work_date: '2026-08-21',
        first_excluded_batch_id: 'AIRE-PAY-OLD',
        latest_excluded_batch_id: 'AIRE-PAY-CURRENT',
        exclusion_reason: 'pending_approval',
        held_total_hours: 8,
        current_total_hours: 8,
        status: 'partially_paid',
        included_batch: {
          id: 'AIRE-PAY-CURRENT',
          start_date: '2026-09-01',
          end_date: '2026-09-15',
          processing: {
            status: 'partially_paid',
            occurred_at: '2026-09-16T08:00:00Z',
            external_system: 'cornerstone_payroll',
            paid_hours: 6,
            outstanding_hours: 2,
          },
        },
      }],
      summary: { awaiting_approval_count: 0, ready_for_next_batch_count: 0, in_payroll_count: 1, not_payable_count: 0 },
      truncated: false,
    } })

    renderPayrollRuns()

    expect(await screen.findByText('Partially paid')).toBeInTheDocument()
    expect(screen.getByText('6.00 hrs paid · 2.00 hrs outstanding')).toBeInTheDocument()
    expect(screen.getByText(/remaining hours stay visible/)).toBeInTheDocument()
  })

  it('shows paid and outstanding hours on the finalized batch ledger', async () => {
    const paidBatch = {
      ...finalized,
      processing: {
        status: 'payment_issued' as const,
        occurred_at: '2026-09-01T08:00:00Z',
        external_system: 'cornerstone_payroll',
        external_pay_period_id: '42',
        paid_hours: 8,
        outstanding_hours: 0,
        lines: [],
      },
    }
    apiMock.getPayrollBatches.mockResolvedValue({ data: {
      payroll_batches: [paidBatch],
      total_count: 1,
      truncated: false,
    } })
    apiMock.getPayrollBatch.mockResolvedValue({ data: paidBatch })

    renderPayrollRuns()

    const batchButton = await screen.findByRole('button', { name: /AIRE-PAY-20260831-ABC123.*Paid/i })
    expect(screen.getByText('8.00 hrs paid · 0.00 hrs outstanding')).toBeInTheDocument()

    fireEvent.click(batchButton)

    expect(await screen.findByText(/Paid · Cornerstone period 42/)).toBeInTheDocument()
    expect(screen.getAllByText('8.00 hrs paid · 0.00 hrs outstanding').length).toBeGreaterThan(1)
  })

  it('renders safe fallbacks for processing statuses added by a newer backend', async () => {
    apiMock.getPayrollBatches.mockResolvedValue({ data: {
      payroll_batches: [{
        ...finalized,
        processing: {
          status: 'settlement_paused',
          occurred_at: '2026-09-02T00:00:00Z',
          external_system: 'cornerstone_payroll',
          external_pay_period_id: '42',
        },
      }],
      total_count: 1,
      truncated: false,
    } })
    apiMock.getPayrollCarryovers.mockResolvedValue({ data: {
      items: [{
        source_time_entry_id: '52',
        source_user_id: '7',
        display_name: 'Alice Pilot',
        email: 'alice@example.com',
        category: { id: 3, key: 'flight', name: 'Flight Hours' },
        original_work_date: '2026-08-21',
        first_excluded_batch_id: 'AIRE-PAY-OLD',
        latest_excluded_batch_id: 'AIRE-PAY-OLD',
        exclusion_reason: 'pending_approval',
        held_total_hours: 4,
        current_total_hours: 4,
        status: 'manual_hold',
        included_batch: null,
      }],
      summary: { awaiting_approval_count: 0, ready_for_next_batch_count: 0, in_payroll_count: 0, not_payable_count: 0 },
      truncated: false,
    } })

    renderPayrollRuns()

    expect(await screen.findByText('settlement_paused')).toBeInTheDocument()
    expect(screen.getByText('manual_hold')).toBeInTheDocument()
    expect(screen.getByText(/not yet recognized by this version of AIRE/)).toBeInTheDocument()
  })

  it('renders zero-value fallbacks for incomplete historical batch summaries', async () => {
    apiMock.getPayrollBatches.mockResolvedValue({ data: {
      payroll_batches: [{ ...finalized, summary: {} }],
      total_count: 1,
      truncated: false,
    } })
    apiMock.getPayrollCarryovers.mockResolvedValue({ data: {
      items: [],
      summary: { awaiting_approval_count: 0, ready_for_next_batch_count: 0, in_payroll_count: 0, not_payable_count: 0 },
      truncated: false,
    } })

    renderPayrollRuns()

    expect(await screen.findByText('0.00 hrs')).toBeInTheDocument()
    expect(screen.getByText('0 employees')).toBeInTheDocument()
    expect(screen.getByText('0 excluded')).toBeInTheDocument()
  })

  it('opens a linked period and preserves it across the workspace', async () => {
    renderPayrollRuns('/admin/payroll?start_date=2026-08-01&end_date=2026-08-15')
    await screen.findByText('No payroll batches have been finalized yet.')

    expect(screen.getByLabelText('Period start')).toHaveValue('2026-08-01')
    expect(screen.getByLabelText('Period end')).toHaveValue('2026-08-15')
    expect(screen.getByRole('link', { name: 'Review approvals' })).toHaveAttribute('href', expect.stringContaining('through_date=2026-08-15'))
    expect(screen.getByRole('link', { name: 'View live hours' })).toHaveAttribute('href', '/admin/time?start_date=2026-08-01&end_date=2026-08-15&tab=reports')
  })

  it('synchronizes the selected period when same-route query parameters change', async () => {
    render(
      <MemoryRouter initialEntries={['/admin/payroll?start_date=2026-08-01&end_date=2026-08-15']}>
        <PayrollRouteHarness />
      </MemoryRouter>,
    )
    await screen.findByText('No payroll batches have been finalized yet.')

    fireEvent.click(screen.getByRole('button', { name: 'Open July payroll' }))

    await waitFor(() => expect(screen.getByLabelText('Period start')).toHaveValue('2026-07-01'))
    expect(screen.getByLabelText('Period end')).toHaveValue('2026-07-15')
    fireEvent.click(screen.getByRole('button', { name: 'Preview cutoff' }))
    await waitFor(() => expect(apiMock.previewPayrollBatch).toHaveBeenCalledWith('2026-07-01', '2026-07-15'))
  })

  it('keeps a start-date edit while the range is temporarily reversed', async () => {
    renderPayrollRuns('/admin/payroll?start_date=2026-08-16&end_date=2026-08-31')
    await screen.findByText('No payroll batches have been finalized yet.')

    fireEvent.change(screen.getByLabelText('Period start'), { target: { value: '2026-09-01' } })

    expect(screen.getByLabelText('Period start')).toHaveValue('2026-09-01')
    expect(screen.getByLabelText('Period end')).toHaveValue('2026-08-31')
    expect(screen.getByRole('button', { name: 'Preview cutoff' })).toBeDisabled()
    expect(screen.getByRole('link', { name: 'Approvals' })).toHaveAttribute(
      'href',
      '/admin/time?start_date=2026-08-16&end_date=2026-08-31&tab=approvals&through_date=2026-08-31',
    )
    expect(screen.getByRole('link', { name: 'Hours Reports' })).toHaveAttribute(
      'href',
      '/admin/time?start_date=2026-08-16&end_date=2026-08-31&tab=reports',
    )

    fireEvent.change(screen.getByLabelText('Period end'), { target: { value: '2026-09-15' } })
    expect(screen.getByRole('button', { name: 'Preview cutoff' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: 'Preview cutoff' }))

    await waitFor(() => expect(apiMock.previewPayrollBatch).toHaveBeenCalledWith('2026-09-01', '2026-09-15'))
  })

  it('requires a review confirmation before finalizing an immutable batch', async () => {
    renderPayrollRuns()
    await screen.findByText('No payroll batches have been finalized yet.')
    fireEvent.click(screen.getByRole('button', { name: 'Preview cutoff' }))
    await screen.findByText('Alice Pilot')

    fireEvent.click(screen.getByRole('button', { name: 'Finalize this cutoff' }))
    const confirmButton = screen.getByRole('button', { name: 'Finalize payroll batch' })
    expect(confirmButton).toBeDisabled()
    fireEvent.click(screen.getByRole('checkbox'))
    expect(confirmButton).toBeEnabled()
    fireEvent.click(confirmButton)

    await waitFor(() => expect(apiMock.finalizePayrollBatch).toHaveBeenCalledWith(expect.objectContaining({
      start_date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      end_date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      acknowledge_negative_adjustments: false,
    })))
    expect(await screen.findByText('Finalized batch')).toBeInTheDocument()
  })

  it('blocks finalization when included work is missing a category', async () => {
    apiMock.previewPayrollBatch.mockResolvedValue({
      data: {
        ...preview,
        can_finalize: false,
        issues: { ...issues, missing_category_count: 1 },
      },
    })
    renderPayrollRuns()
    await screen.findByText('No payroll batches have been finalized yet.')
    fireEvent.click(screen.getByRole('button', { name: 'Preview cutoff' }))

    expect(await screen.findByText(/Finalization is blocked/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Finalize this cutoff' })).toBeDisabled()
    expect(screen.getByRole('link', { name: '1 Missing category' })).toHaveAttribute(
      'href',
      '/admin/time?start_date=2026-08-16&end_date=2026-08-31&tab=reports&category_status=uncategorized',
    )
  })

  it('reviews and records an already-processed historical payroll without losing late hours', async () => {
    const historicalPreview = {
      ...preview,
      cutoff_at: '2026-08-31T03:06:00Z',
      can_finalize: false,
      issues: { ...issues, missing_category_count: 1, negative_adjustment_count: 1, pending_approval_count: 9 },
      summary: { ...preview.summary, total_hours: 599.06, exclusion_count: 10 },
    }
    const manuallyProcessed = {
      ...finalized,
      cutoff_at: historicalPreview.cutoff_at,
      processing: {
        status: 'committed',
        occurred_at: '2026-08-31T03:18:05Z',
        external_system: 'cornerstone_payroll_manual',
        external_pay_period_id: '61',
      },
      summary: historicalPreview.summary,
      issues: historicalPreview.issues,
      payload: { ...finalized.payload, ...historicalPreview, preview: undefined },
    }
    apiMock.previewPayrollBatch
      .mockResolvedValueOnce({ data: { ...preview, can_finalize: false, issues: historicalPreview.issues } })
      .mockResolvedValueOnce({ data: historicalPreview })
    apiMock.finalizePayrollBatch.mockResolvedValueOnce({ data: manuallyProcessed })

    renderPayrollRuns('/admin/payroll?start_date=2026-08-01&end_date=2026-08-15')
    await screen.findByText('No payroll batches have been finalized yet.')
    fireEvent.click(screen.getByRole('button', { name: 'Preview cutoff' }))
    await screen.findByText(/Finalization is blocked/)
    fireEvent.click(screen.getByRole('button', { name: 'Record already processed' }))
    await screen.findByRole('heading', { name: 'Record payroll processed outside the integration' })

    fireEvent.change(screen.getByLabelText(/Hours frozen at/), { target: { value: '2026-08-31T13:06' } })
    fireEvent.change(screen.getByLabelText(/Cornerstone processed at/), { target: { value: '2026-08-31T13:18' } })
    fireEvent.click(screen.getByRole('button', { name: 'Review historical snapshot' }))

    expect(await screen.findByText('599.06 hrs')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Cornerstone pay period ID'), { target: { value: '61' } })
    fireEvent.change(screen.getByLabelText(/Reconciliation note/), { target: { value: 'Matched against committed payroll period 61' } })
    fireEvent.click(screen.getByRole('checkbox', { name: /I confirm these 1 legacy uncategorized/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: /I confirm these 1 negative correction/ }))
    fireEvent.change(screen.getByLabelText('Negative correction explanation'), { target: { value: 'Corrected historical overpayment' } })
    fireEvent.click(screen.getByRole('checkbox', { name: /I compared this historical AIRE snapshot/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Record as processed manually' }))

    await waitFor(() => expect(apiMock.finalizePayrollBatch).toHaveBeenCalledWith(expect.objectContaining({
      start_date: '2026-08-01',
      end_date: '2026-08-15',
      manual_processing: true,
      cutoff_at: '2026-08-31T03:06:00.000Z',
      processed_at: '2026-08-31T03:18:00.000Z',
      external_pay_period_id: '61',
      acknowledge_missing_categories: true,
      acknowledge_negative_adjustments: true,
      negative_adjustment_note: 'Corrected historical overpayment',
      processing_note: 'Matched against committed payroll period 61',
    })))
    expect(await screen.findByText('Finalized batch')).toBeInTheDocument()
  })

  it('discards a historical preview response after the Guam cutoff changes', async () => {
    let resolveOldPreview: (value: { data: typeof preview }) => void = () => undefined
    const oldPreviewRequest = new Promise<{ data: typeof preview }>((resolve) => { resolveOldPreview = resolve })
    const currentPreview = {
      ...preview,
      cutoff_at: '2026-08-31T04:00:00.000Z',
      summary: { ...preview.summary, total_hours: 10 },
    }
    apiMock.previewPayrollBatch
      .mockResolvedValueOnce({ data: preview })
      .mockReturnValueOnce(oldPreviewRequest)
      .mockResolvedValueOnce({ data: currentPreview })

    renderPayrollRuns('/admin/payroll?start_date=2026-08-01&end_date=2026-08-15')
    await screen.findByText('No payroll batches have been finalized yet.')
    fireEvent.click(screen.getByRole('button', { name: 'Preview cutoff' }))
    await screen.findByText('Alice Pilot')
    fireEvent.click(screen.getByRole('button', { name: 'Record already processed' }))

    const cutoffInput = screen.getByLabelText(/Hours frozen at/)
    fireEvent.change(cutoffInput, { target: { value: '2026-08-31T13:00' } })
    fireEvent.click(screen.getByRole('button', { name: 'Review historical snapshot' }))
    fireEvent.change(cutoffInput, { target: { value: '2026-08-31T14:00' } })
    fireEvent.click(screen.getByRole('button', { name: 'Review historical snapshot' }))

    expect(await screen.findByText('10.00 hrs')).toBeInTheDocument()
    await act(async () => {
      resolveOldPreview({ data: { ...preview, cutoff_at: '2026-08-31T03:00:00.000Z', summary: { ...preview.summary, total_hours: 99 } } })
      await oldPreviewRequest
    })

    expect(screen.getByText('10.00 hrs')).toBeInTheDocument()
    expect(screen.queryByText('99.00 hrs')).not.toBeInTheDocument()
  })

  it('requires and submits a trimmed explanation for negative corrections', async () => {
    apiMock.previewPayrollBatch.mockResolvedValue({
      data: {
        ...preview,
        requires_negative_adjustment_acknowledgement: true,
        issues: { ...issues, negative_adjustment_count: 1 },
      },
    })
    renderPayrollRuns()
    await screen.findByText('No payroll batches have been finalized yet.')
    fireEvent.click(screen.getByRole('button', { name: 'Preview cutoff' }))
    await screen.findByText('Alice Pilot')

    fireEvent.click(screen.getByRole('button', { name: 'Finalize this cutoff' }))
    const confirmButton = screen.getByRole('button', { name: 'Finalize payroll batch' })
    fireEvent.click(screen.getByRole('checkbox'))
    expect(confirmButton).toBeDisabled()

    fireEvent.change(screen.getByLabelText('Correction explanation'), {
      target: { value: '  Corrected prior overpayment  ' },
    })
    expect(confirmButton).toBeEnabled()
    fireEvent.click(confirmButton)

    await waitFor(() => expect(apiMock.finalizePayrollBatch).toHaveBeenCalledWith(expect.objectContaining({
      acknowledge_negative_adjustments: true,
      negative_adjustment_note: 'Corrected prior overpayment',
    })))
  })

  it('clears a prior payroll-history error after a successful refresh', async () => {
    apiMock.getPayrollBatches
      .mockResolvedValueOnce({ error: 'Temporary history failure' })
      .mockResolvedValue({ data: { payroll_batches: [] } })
    renderPayrollRuns()
    expect(await screen.findByRole('alert')).toHaveTextContent('Temporary history failure')

    fireEvent.click(screen.getByRole('button', { name: 'Preview cutoff' }))
    await screen.findByText('Alice Pilot')
    fireEvent.click(screen.getByRole('button', { name: 'Finalize this cutoff' }))
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'Finalize payroll batch' }))

    await waitFor(() => expect(screen.queryByText('Temporary history failure')).not.toBeInTheDocument())
  })

  it('ignores an older payroll-history response that finishes after finalization refreshes it', async () => {
    let resolveInitialHistory: (value: { data: { payroll_batches: never[]; total_count: number; truncated: boolean } }) => void = () => undefined
    const initialHistory = new Promise<{ data: { payroll_batches: never[]; total_count: number; truncated: boolean } }>((resolve) => {
      resolveInitialHistory = resolve
    })
    apiMock.getPayrollBatches
      .mockReturnValueOnce(initialHistory)
      .mockResolvedValueOnce({ data: { payroll_batches: [finalized], total_count: 1, truncated: false } })

    renderPayrollRuns()
    fireEvent.click(screen.getByRole('button', { name: 'Preview cutoff' }))
    await screen.findByText('Alice Pilot')
    fireEvent.click(screen.getByRole('button', { name: 'Finalize this cutoff' }))
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'Finalize payroll batch' }))

    expect(await screen.findByRole('button', { name: /AIRE-PAY-20260831-ABC123/ })).toBeInTheDocument()
    resolveInitialHistory({ data: { payroll_batches: [], total_count: 0, truncated: false } })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /AIRE-PAY-20260831-ABC123/ })).toBeInTheDocument()
    })
  })

  it('ignores an older carryover response that finishes after finalization refreshes it', async () => {
    let resolveInitialCarryovers: (value: { data: { items: never[]; summary: { awaiting_approval_count: number; ready_for_next_batch_count: number; in_payroll_count: number; not_payable_count: number }; truncated: boolean } }) => void = () => undefined
    const initialCarryovers = new Promise<{ data: { items: never[]; summary: { awaiting_approval_count: number; ready_for_next_batch_count: number; in_payroll_count: number; not_payable_count: number }; truncated: boolean } }>((resolve) => {
      resolveInitialCarryovers = resolve
    })
    const refreshedCarryovers = {
      items: [{
        source_time_entry_id: '52',
        source_user_id: '7',
        display_name: 'Alice Pilot',
        email: 'alice@example.com',
        category: { id: 3, key: 'flight', name: 'Flight Hours' },
        original_work_date: '2026-08-21',
        first_excluded_batch_id: 'AIRE-PAY-OLD',
        latest_excluded_batch_id: 'AIRE-PAY-OLD',
        exclusion_reason: 'pending_approval',
        held_total_hours: 4,
        current_total_hours: 4,
        status: 'ready_for_next_batch',
        included_batch: null,
      }],
      summary: { awaiting_approval_count: 0, ready_for_next_batch_count: 1, in_payroll_count: 0, not_payable_count: 0 },
      truncated: false,
    }
    apiMock.getPayrollCarryovers
      .mockReturnValueOnce(initialCarryovers)
      .mockResolvedValueOnce({ data: refreshedCarryovers })

    renderPayrollRuns()
    fireEvent.click(screen.getByRole('button', { name: 'Preview cutoff' }))
    await screen.findByText('Alice Pilot')
    fireEvent.click(screen.getByRole('button', { name: 'Finalize this cutoff' }))
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'Finalize payroll batch' }))

    expect(await screen.findByText('Ready for next cutoff')).toBeInTheDocument()
    await act(async () => {
      resolveInitialCarryovers({ data: {
        items: [],
        summary: { awaiting_approval_count: 0, ready_for_next_batch_count: 0, in_payroll_count: 0, not_payable_count: 0 },
        truncated: false,
      } })
      await initialCarryovers
    })

    expect(screen.getByText('Ready for next cutoff')).toBeInTheDocument()
    expect(screen.queryByText('No unpaid carryover items need attention.')).not.toBeInTheDocument()
  })

  it('discards a pending preview after opening an immutable batch', async () => {
    let resolvePreview!: (value: { data: typeof preview }) => void
    apiMock.previewPayrollBatch.mockReturnValueOnce(new Promise((resolve) => { resolvePreview = resolve }))
    apiMock.getPayrollBatches.mockResolvedValue({ data: { payroll_batches: [finalized], total_count: 1, truncated: false } })
    renderPayrollRuns()
    const batchButton = await screen.findByRole('button', { name: /AIRE-PAY-20260831-ABC123/ })
    fireEvent.click(screen.getByRole('button', { name: 'Preview cutoff' }))
    fireEvent.click(batchButton)
    await screen.findByText('Finalized batch')
    await act(async () => { resolvePreview({ data: preview }) })
    expect(screen.queryByRole('button', { name: 'Finalize this cutoff' })).not.toBeInTheDocument()
    expect(screen.getByText('Finalized batch')).toBeInTheDocument()
  })

  it('discards a pending immutable batch after switching to live preview', async () => {
    let resolveBatch!: (value: { data: typeof finalized }) => void
    apiMock.getPayrollBatch.mockReturnValueOnce(new Promise((resolve) => { resolveBatch = resolve }))
    apiMock.getPayrollBatches.mockResolvedValue({ data: { payroll_batches: [finalized], total_count: 1, truncated: false } })
    renderPayrollRuns()
    fireEvent.click(await screen.findByRole('button', { name: /AIRE-PAY-20260831-ABC123/ }))
    await waitFor(() => expect(apiMock.getPayrollBatch).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: 'Preview cutoff' }))
    await screen.findByText('Live preview')
    await act(async () => { resolveBatch({ data: finalized }) })
    expect(screen.queryByText('Finalized batch')).not.toBeInTheDocument()
    expect(screen.getByText('Live preview')).toBeInTheDocument()
  })

  it('opens a finalized batch from history', async () => {
    apiMock.getPayrollBatches.mockResolvedValue({
      data: { payroll_batches: [finalized], total_count: 1, truncated: false },
    })
    renderPayrollRuns()

    fireEvent.click(await screen.findByRole('button', { name: /AIRE-PAY-20260831-ABC123/ }))

    await waitFor(() => expect(apiMock.getPayrollBatch).toHaveBeenCalledWith(finalized.id))
    expect(await screen.findByText('Alice Pilot')).toBeInTheDocument()
    expect(screen.getByText('Finalized batch')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'View activity' })).toHaveAttribute(
      'href',
      '/admin/activity?event_category=payroll&search=2026-08-16%20through%202026-08-31',
    )
  })

  it('ignores an older batch response after a newer history selection', async () => {
    const firstBatch = finalized
    const secondBatch = {
      ...finalized,
      id: 'AIRE-PAY-20260731-DEF456',
      start_date: '2026-07-16',
      end_date: '2026-07-31',
      payload: {
        ...finalized.payload,
        batch_id: 'AIRE-PAY-20260731-DEF456',
        start_date: '2026-07-16',
        end_date: '2026-07-31',
        export: {
          ...finalized.payload.export,
          id: 'AIRE-PAY-20260731-DEF456',
          batch_id: 'AIRE-PAY-20260731-DEF456',
        },
      },
    }
    let resolveFirst: (value: { data: typeof firstBatch }) => void = () => undefined
    let resolveSecond: (value: { data: typeof secondBatch }) => void = () => undefined
    const firstRequest = new Promise<{ data: typeof firstBatch }>((resolve) => { resolveFirst = resolve })
    const secondRequest = new Promise<{ data: typeof secondBatch }>((resolve) => { resolveSecond = resolve })
    apiMock.getPayrollBatches.mockResolvedValue({
      data: { payroll_batches: [firstBatch, secondBatch], total_count: 2, truncated: false },
    })
    apiMock.getPayrollBatch
      .mockReset()
      .mockReturnValueOnce(firstRequest)
      .mockReturnValueOnce(secondRequest)
    renderPayrollRuns()

    fireEvent.click(await screen.findByRole('button', { name: /AIRE-PAY-20260831-ABC123/ }))
    await waitFor(() => expect(apiMock.getPayrollBatch).toHaveBeenCalledWith(firstBatch.id))
    fireEvent.click(screen.getByRole('button', { name: /AIRE-PAY-20260731-DEF456/ }))
    await waitFor(() => expect(apiMock.getPayrollBatch).toHaveBeenCalledWith(secondBatch.id))
    await act(async () => {
      resolveSecond({ data: secondBatch })
      await secondRequest
    })

    expect(screen.getByLabelText('Period start')).toHaveValue('2026-07-16')
    expect(screen.getByLabelText('Period end')).toHaveValue('2026-07-31')

    await act(async () => {
      resolveFirst({ data: firstBatch })
      await firstRequest
    })

    expect(screen.getByLabelText('Period start')).toHaveValue('2026-07-16')
    expect(screen.getByLabelText('Period end')).toHaveValue('2026-07-31')
    expect(screen.getByRole('link', { name: 'View activity' })).toHaveAttribute(
      'href',
      '/admin/activity?event_category=payroll&search=2026-07-16%20through%202026-07-31',
    )
  })

  it('ignores a batch response after the routed payroll period changes', async () => {
    let resolveBatch: (value: { data: typeof finalized }) => void = () => undefined
    const deferredBatch = new Promise<{ data: typeof finalized }>((resolve) => { resolveBatch = resolve })
    apiMock.getPayrollBatches.mockResolvedValue({
      data: { payroll_batches: [finalized], total_count: 1, truncated: false },
    })
    apiMock.getPayrollBatch.mockReturnValueOnce(deferredBatch)
    render(
      <MemoryRouter initialEntries={['/admin/payroll?start_date=2026-08-16&end_date=2026-08-31']}>
        <PayrollRouteHarness />
      </MemoryRouter>,
    )

    fireEvent.click(await screen.findByRole('button', { name: /AIRE-PAY-20260831-ABC123/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Open July payroll' }))
    await waitFor(() => expect(screen.getByLabelText('Period start')).toHaveValue('2026-07-01'))

    await act(async () => {
      resolveBatch({ data: finalized })
      await deferredBatch
    })

    expect(screen.getByLabelText('Period start')).toHaveValue('2026-07-01')
    expect(screen.getByLabelText('Period end')).toHaveValue('2026-07-15')
    expect(screen.queryByRole('link', { name: 'View activity' })).not.toBeInTheDocument()
  })

  it('downloads a finalized batch and reports an empty download response', async () => {
    apiMock.getPayrollBatches.mockResolvedValue({
      data: { payroll_batches: [finalized], total_count: 1, truncated: false },
    })
    apiMock.downloadPayrollBatch
      .mockResolvedValueOnce({ blob: new Blob(['csv']), filename: 'batch.csv' })
      .mockResolvedValueOnce({ error: 'Export unavailable' })
    const createObjectUrl = vi.fn(() => 'blob:test')
    const revokeObjectUrl = vi.fn()
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectUrl })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectUrl })
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    renderPayrollRuns()
    fireEvent.click(await screen.findByRole('button', { name: /AIRE-PAY-20260831-ABC123/ }))
    await screen.findByText('Alice Pilot')

    fireEvent.click(screen.getByRole('button', { name: 'Download finalized CSV' }))
    await waitFor(() => expect(apiMock.downloadPayrollBatch).toHaveBeenCalledWith(finalized.id))
    expect(createObjectUrl).toHaveBeenCalledOnce()
    expect(clickSpy).toHaveBeenCalledOnce()
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:test')

    fireEvent.click(screen.getByRole('button', { name: 'Download finalized CSV' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Export unavailable')
  })

  it('signals when the permanent history response is truncated', async () => {
    apiMock.getPayrollBatches.mockResolvedValue({
      data: { payroll_batches: [finalized], total_count: 135, truncated: true },
    })
    renderPayrollRuns()

    expect(await screen.findByRole('status')).toHaveTextContent('newest 1 of 135')
  })

  it('traps focus inside the finalize dialog and restores it on close', async () => {
    renderPayrollRuns()
    await screen.findByText('No payroll batches have been finalized yet.')
    fireEvent.click(screen.getByRole('button', { name: 'Preview cutoff' }))
    await screen.findByText('Alice Pilot')
    const trigger = screen.getByRole('button', { name: 'Finalize this cutoff' })
    trigger.focus()
    fireEvent.click(trigger)

    const dialog = screen.getByRole('dialog', { name: /finalize this payroll cutoff/i })
    await waitFor(() => expect(dialog).toHaveFocus())
    const checkbox = screen.getByRole('checkbox')
    const closeButton = screen.getByRole('button', { name: 'Keep reviewing' })
    fireEvent.keyDown(dialog, { key: 'Tab' })
    expect(checkbox).toHaveFocus()
    fireEvent.keyDown(checkbox, { key: 'Tab', shiftKey: true })
    expect(closeButton).toHaveFocus()

    fireEvent.click(closeButton)
    expect(trigger).toHaveFocus()
  })

  it('does not reopen confirmation after the preview is cleared', async () => {
    renderPayrollRuns()
    await screen.findByText('No payroll batches have been finalized yet.')
    fireEvent.click(screen.getByRole('button', { name: 'Preview cutoff' }))
    await screen.findByText('Alice Pilot')
    fireEvent.click(screen.getByRole('button', { name: 'Finalize this cutoff' }))
    expect(screen.getByRole('dialog', { name: /finalize this payroll cutoff/i })).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Period start'), { target: { value: '2026-08-01' } })
    expect(screen.queryByRole('dialog', { name: /finalize this payroll cutoff/i })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Preview cutoff' }))
    await screen.findByText('Alice Pilot')
    expect(screen.queryByRole('dialog', { name: /finalize this payroll cutoff/i })).not.toBeInTheDocument()
  })

  it('discards a preview response when the date range changes before it resolves', async () => {
    let resolvePreview: (value: { data: typeof preview }) => void = () => undefined
    const deferredPreview = new Promise<{ data: typeof preview }>((resolve) => {
      resolvePreview = resolve
    })
    apiMock.previewPayrollBatch.mockReturnValueOnce(deferredPreview)
    renderPayrollRuns()
    await screen.findByText('No payroll batches have been finalized yet.')

    fireEvent.click(screen.getByRole('button', { name: 'Preview cutoff' }))
    fireEvent.change(screen.getByLabelText('Period start'), { target: { value: '2026-08-01' } })
    resolvePreview({ data: preview })

    await waitFor(() => expect(screen.getByRole('button', { name: 'Preview cutoff' })).toBeEnabled())
    expect(screen.queryByText('Alice Pilot')).not.toBeInTheDocument()
    expect(screen.queryByText('LIVE PREVIEW')).not.toBeInTheDocument()
  })

 it('links carried work to its original date and entry rather than the receiving cutoff', async () => {
   const carried = structuredClone(finalized)
   carried.payload.employees[0].adjustments[0].original_work_date = '2026-05-04'
   carried.payload.employees[0].adjustments[0].source_kind = 'carryover'
   apiMock.getPayrollBatch.mockResolvedValue({ data: carried })
   renderPayrollRuns('/admin/payroll?batch_id=AIRE-PAY-20260831-ABC123')
   const link = await screen.findByRole('link', { name: 'Review original hours' })
   expect(screen.getByText('1 payroll line')).toBeInTheDocument()
   expect(screen.getByText('Carried forward hours')).toBeInTheDocument()
   expect(screen.queryByText('Late approval carried forward')).not.toBeInTheDocument()
   const url = new URL(link.getAttribute('href')!, 'http://localhost')
   expect(url.searchParams.get('start_date')).toBe('2026-05-04')
   expect(url.searchParams.get('end_date')).toBe('2026-05-04')
   expect(url.searchParams.get('period')).toBe('2026-05-01')
   expect(url.searchParams.get('entry')).toBe('51')
   const employeeUrl = new URL(screen.getByRole('link', { name: 'Alice Pilot' }).getAttribute('href')!, 'http://localhost')
   expect(employeeUrl.searchParams.get('start_date')).toBe('2026-05-04')
 })

})


it('keeps paid positive lines and a committed accounting correction distinct on the batch ledger', async () => {
  const context = { accounting_only: true, correction_disposition_id: '9', original_pay_period_id: '10', original_payroll_item_id: '11', corrective_pay_period_id: '44', corrective_payroll_item_id: '55' }
  const accountingBatch = { ...finalized, processing: { status: 'partially_paid' as const, occurred_at: '2026-09-01T08:00:00Z', external_system: 'cornerstone_payroll', external_pay_period_id: null,
    paid_hours: 8, outstanding_hours: 0, accounting_only: false, accounting_correction_line_count: 1, accounting_correction_hours: -1,
    lines: [{ source_time_entry_id: '51', source_line_key: 'negative', source_kind: 'correction', total_hours: -1, regular_hours: -1, overtime_hours: 0, status: 'committed', accounting_only: true, accounting_correction: context, external_pay_period_id: '44', external_payroll_item_id: '55' }],
  } }
  apiMock.getPayrollBatches.mockResolvedValue({ data: { payroll_batches: [accountingBatch], total_count: 1, truncated: false } })
  apiMock.getPayrollBatch.mockResolvedValue({ data: accountingBatch })
  renderPayrollRuns()
  const batchButton = await screen.findByRole('button', { name: /AIRE-PAY-20260831-ABC123.*accounting correction recorded/i })
  expect(screen.getByText(/8.00 hrs paid · 0.00 hrs cash outstanding · -1.00 hrs accounting correction/)).toBeInTheDocument()
  fireEvent.click(batchButton)
  expect(await screen.findByText(/Accounting correction committed · entry 51/)).toBeInTheDocument()
  expect(screen.getByText(/Corrective payroll period 44 · item 55 · disposition 9/)).toBeInTheDocument()
  expect(screen.getByText(/No new payment or recovery recorded/)).toBeInTheDocument()
  expect(screen.queryByText(/^Paid$/)).not.toBeInTheDocument()
})
