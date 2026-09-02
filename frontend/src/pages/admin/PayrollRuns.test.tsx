import '@testing-library/jest-dom'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
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
    fireEvent.click(screen.getByRole('button', { name: /AIRE-PAY-20260731-DEF456/ }))
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
})
