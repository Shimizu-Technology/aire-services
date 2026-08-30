import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import PayrollRuns from './PayrollRuns'

const apiMock = vi.hoisted(() => ({
  getPayrollBatches: vi.fn(),
  getPayrollBatch: vi.fn(),
  previewPayrollBatch: vi.fn(),
  finalizePayrollBatch: vi.fn(),
  downloadPayrollBatch: vi.fn(),
}))

vi.mock('../../lib/api', () => ({ api: apiMock }))

const issues = {
  missing_category_count: 0,
  missing_rate_count: 0,
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
      line_key: 'category:3:rate:3200',
      source_kind: 'current',
      original_work_date: '2026-08-20',
      original_week_start: '2026-08-16',
      source_category_id: '3',
      category: { id: 3, key: 'flight', name: 'Flight Hours' },
      total_hours: 8,
      regular_hours: 8,
      overtime_hours: 0,
      effective_rate_cents: 3200,
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

describe('PayrollRuns', () => {
  beforeEach(() => {
    Object.values(apiMock).forEach((mock) => mock.mockReset())
    apiMock.getPayrollBatches.mockResolvedValue({ data: { payroll_batches: [] } })
    apiMock.previewPayrollBatch.mockResolvedValue({ data: preview })
    apiMock.finalizePayrollBatch.mockResolvedValue({ data: finalized })
  })

  it('previews payable hours separately from tracked exclusions', async () => {
    render(<PayrollRuns />)
    await screen.findByText('No payroll batches have been finalized yet.')

    fireEvent.click(screen.getByRole('button', { name: 'Preview cutoff' }))

    expect(await screen.findByText('Alice Pilot')).toBeInTheDocument()
    expect(screen.getByText('Pending approval', { selector: 'p' })).toBeInTheDocument()
    expect(screen.getAllByText('8.00 hrs', { selector: 'p' }).length).toBeGreaterThan(0)
    expect(screen.getByText(/Pending and open work stays attached/)).toBeInTheDocument()
  })

  it('requires a review confirmation before finalizing an immutable batch', async () => {
    render(<PayrollRuns />)
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

  it('blocks finalization when included work is missing payroll dimensions', async () => {
    apiMock.previewPayrollBatch.mockResolvedValue({
      data: {
        ...preview,
        can_finalize: false,
        issues: { ...issues, missing_category_count: 1 },
      },
    })
    render(<PayrollRuns />)
    await screen.findByText('No payroll batches have been finalized yet.')
    fireEvent.click(screen.getByRole('button', { name: 'Preview cutoff' }))

    expect(await screen.findByText(/Finalization is blocked/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Finalize this cutoff' })).toBeDisabled()
  })

  it('requires and submits a trimmed explanation for negative corrections', async () => {
    apiMock.previewPayrollBatch.mockResolvedValue({
      data: {
        ...preview,
        requires_negative_adjustment_acknowledgement: true,
        issues: { ...issues, negative_adjustment_count: 1 },
      },
    })
    render(<PayrollRuns />)
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
    render(<PayrollRuns />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Temporary history failure')

    fireEvent.click(screen.getByRole('button', { name: 'Preview cutoff' }))
    await screen.findByText('Alice Pilot')
    fireEvent.click(screen.getByRole('button', { name: 'Finalize this cutoff' }))
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'Finalize payroll batch' }))

    await waitFor(() => expect(screen.queryByText('Temporary history failure')).not.toBeInTheDocument())
  })

  it('ignores an older payroll-history response that finishes after finalization refreshes it', async () => {
    let resolveInitialHistory: (value: { data: { payroll_batches: never[] } }) => void = () => undefined
    const initialHistory = new Promise<{ data: { payroll_batches: never[] } }>((resolve) => {
      resolveInitialHistory = resolve
    })
    apiMock.getPayrollBatches
      .mockReturnValueOnce(initialHistory)
      .mockResolvedValueOnce({ data: { payroll_batches: [finalized] } })

    render(<PayrollRuns />)
    fireEvent.click(screen.getByRole('button', { name: 'Preview cutoff' }))
    await screen.findByText('Alice Pilot')
    fireEvent.click(screen.getByRole('button', { name: 'Finalize this cutoff' }))
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'Finalize payroll batch' }))

    expect(await screen.findByRole('button', { name: /AIRE-PAY-20260831-ABC123/ })).toBeInTheDocument()
    resolveInitialHistory({ data: { payroll_batches: [] } })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /AIRE-PAY-20260831-ABC123/ })).toBeInTheDocument()
    })
  })
})
