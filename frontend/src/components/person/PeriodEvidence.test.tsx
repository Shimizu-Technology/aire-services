import '@testing-library/jest-dom'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EvidencePeriod } from '../../lib/employeeEvidenceApi'
import { PeriodEvidence } from './PeriodEvidence'

const mock = vi.hoisted(() => ({ period: vi.fn() }))
vi.mock('../../lib/employeeEvidenceApi', () => ({ employeeEvidenceApi: mock }))
const totals = { worked_hours: 12, eligible_hours: 12, pending_hours: 3, denied_hours: 0, issued_hours: 6, committed_hours: 4, exported_hours: 0, held_hours: 0, needs_reconciliation_hours: 2, current_regular_hours: 12, current_overtime_hours: 0, frozen_regular_hours: 10, frozen_overtime_hours: 0, open_case_count: 0 }
const period = { id: '2026-09-01', start_date: '2026-09-01', end_date: '2026-09-15', summary: totals, review_required: true, entries: [{ id: '19', work_date: '2026-09-08', start_time: '09:00', end_time: '17:00', worked_hours: 12, regular_hours: 12, overtime_hours: 0, issued_hours: 6, committed_hours: 4, needs_reconciliation_hours: 2, category: 'Operations', approval_status: 'approved', description: 'Saved source work' }], coverage_lines: [{ id: 'line1', batch_id: 'batch1', source_time_entry_id: '19', source_kind: 'current', coverage_state: 'issued', regular_hours: 6, overtime_hours: 0, work_date: '2026-09-08', external_pay_period_id: '30', external_payroll_item_id: '99', payment_reference: '1001' }], settlement_cases: [] }
const PERIOD = period as unknown as EvidencePeriod
const identity = { employee: { id: '7', payroll_integration_id: 'employee-uuid' }, integration: { source_instance_id: 'installation-uuid' } } as never

function renderEvidence(value: unknown, showNotMatched = true) {
  render(
    <MemoryRouter>
      <PeriodEvidence
        userId={7}
        period={value as EvidencePeriod}
        identity={identity}
        showNotMatched={showNotMatched}
        shiftHref={(entryId) => `?tab=time&period=2026-09-01&entry=${entryId}`}
      />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  mock.period.mockReset()
  mock.period.mockResolvedValue({ period, employee: { id: '7', payroll_integration_id: 'employee-uuid' }, integration: { source_instance_id: 'installation-uuid' } })
})

describe('period evidence', () => {
  it('shows totals in plain words, each shift and the frozen lines', async () => {
    renderEvidence(PERIOD)
    expect(screen.getByText('Paid (confirmed by Payroll)')).toBeInTheDocument()
    expect(screen.getByText('In a payroll run, not paid yet')).toBeInTheDocument()
    expect(screen.getByText('Not matched to a paycheck yet')).toBeInTheDocument()
    expect(screen.queryByText('Issued source coverage')).not.toBeInTheDocument()
    fireEvent.click(await screen.findByRole('button', { name: /2026-09-08/ }))
    expect(screen.getByRole('link', { name: 'Show on the timecard' })).toHaveAttribute('href', '/?tab=time&period=2026-09-01&entry=19')
    expect(screen.getByRole('link', { name: 'Open frozen batch' })).toHaveAttribute('href', expect.stringContaining('batch_id=batch1'))
  })

  it('leaves not-matched hours out before payday', async () => {
    renderEvidence(PERIOD, false)
    expect(screen.queryByText('Not matched to a paycheck yet')).not.toBeInTheDocument()
    await screen.findByRole('button', { name: /2026-09-08/ })
    expect(screen.queryByText(/not matched/)).not.toBeInTheDocument()
  })

  it('refuses evidence for another person', async () => {
    mock.period.mockResolvedValue({ period, employee: { id: '8', payroll_integration_id: 'employee-uuid' }, integration: { source_instance_id: 'installation-uuid' } })
    renderEvidence(PERIOD)
    expect(await screen.findByRole('alert')).toHaveTextContent('Period evidence identity changed')
  })

  it('explains cancelled payment coverage as committed hours reserved for replacement', async () => {
    const cancelled = { ...period, coverage_lines: period.coverage_lines.map((line) => ({ ...line, status: 'payment_cancelled', coverage_state: 'committed' })) }
    mock.period.mockResolvedValueOnce({ period: cancelled, employee: { id: '7', payroll_integration_id: 'employee-uuid' }, integration: { source_instance_id: 'installation-uuid' } })
    renderEvidence(PERIOD)
    expect(await screen.findByText('Payment cancelled. Payroll remains committed and these hours stay reserved for the replacement.')).toBeInTheDocument()
  })

  it('labels a bank receipt as a transfer instead of a paper check', async () => {
    const bankPeriod = { ...period, coverage_lines: period.coverage_lines.map(line => ({ ...line, payment_method: 'direct_deposit', payment_reference: 'SYNTHETIC-BANK' })) }
    mock.period.mockResolvedValueOnce({ period: bankPeriod, employee: { id: '7', payroll_integration_id: 'employee-uuid' }, integration: { source_instance_id: 'installation-uuid' } })
    renderEvidence(PERIOD)
    expect(await screen.findByText(/bank transfer SYNTHETIC-BANK/)).toBeInTheDocument()
    expect(screen.queryByText(/check SYNTHETIC-BANK/)).not.toBeInTheDocument()
  })
})

it('shows the signed accounting correction separately and preserves the original issued coverage', async () => {
  const context = { accounting_only: true, correction_disposition_id: '9', original_pay_period_id: '30', original_payroll_item_id: '99', corrective_pay_period_id: '44', corrective_payroll_item_id: '55' }
  const corrected = { ...period, review_required: false, summary: { ...totals, worked_hours: 3, eligible_hours: 3, pending_hours: 0, issued_hours: 4, committed_hours: 0, needs_reconciliation_hours: 0, open_case_count: 1, accounting_correction_hours: -1, accounting_correction_line_count: 1 },
    coverage_lines: [...period.coverage_lines, { ...period.coverage_lines[0], id: 'correction', source_kind: 'correction', status: 'committed', coverage_state: 'committed', accounting_only: true, accounting_correction: context, regular_hours: -1, total_hours: -1, external_pay_period_id: '44', external_payroll_item_id: '55', payment_reference: null, payment_method: null }],
  }
  mock.period.mockResolvedValue({ period: corrected, employee: { id: '7', payroll_integration_id: 'employee-uuid' }, integration: { source_instance_id: 'installation-uuid' } })
  renderEvidence(corrected)
  expect(await screen.findByText('Correction to an earlier payroll')).toBeInTheDocument()
  expect(await screen.findByText(/Correction hours · Accounting correction committed · REG -1h/)).toBeInTheDocument()
  expect(screen.getByText(/No new payment or recovery recorded/)).toBeInTheDocument()
  expect(screen.getByText(/item 55/)).toBeInTheDocument()
  expect(screen.getByText(/item 99/)).toHaveTextContent('1001')
  expect(screen.queryByText(/correction.*payment reference Not recorded/)).not.toBeInTheDocument()
})

it('keeps late-created paid case history visible without an unresolved-period badge', async () => {
  const carried = { ...period, review_required: false,
    summary: { ...totals, worked_hours: 4, eligible_hours: 4, pending_hours: 0, issued_hours: 4, committed_hours: 0, needs_reconciliation_hours: 0, open_case_count: 1 },
    settlement_cases: [{ public_id: 'historical-case', source_time_entry_id: '19', origin_reason: 'created_after_cutoff', status: 'in_payroll', completion: 'paid', target_pay_date: '2026-10-30', destination_kind: 'regular', target_external_pay_period_id: 'next-period', action_due_on: '2026-10-15' }],
  }
  mock.period.mockResolvedValue({ period: carried, employee: { id: '7', payroll_integration_id: 'employee-uuid' }, integration: { source_instance_id: 'installation-uuid' } })
  renderEvidence(carried)
  expect(await screen.findByText('Historical reason: Entry was added after cutoff')).toBeInTheDocument()
  expect(screen.getByRole('region', { name: 'Reconciliation notes' })).toHaveTextContent('Paid')
  expect(screen.getByText('Regular payroll · Pay date Fri, Oct 30, 2026')).toBeInTheDocument()
  expect(screen.getByText('Recorded follow-up date: Thu, Oct 15, 2026')).toBeInTheDocument()
  expect(screen.getByText('Recorded case status: Included in payroll · receipt confirmation pending · Payroll reference: next-period')).toBeInTheDocument()
})

it.each([
  { completion: null, status: 'in_payroll', destination_kind: 'supplemental', label: 'Included in payroll · receipt confirmation pending', destination: 'Supplemental payroll · Pay date unavailable' },
  { completion: undefined, status: 'in_payroll', destination_kind: 'regular', label: 'Included in payroll · receipt confirmation pending', destination: 'Regular payroll · Pay date unavailable' },
  { completion: 'accounting_recorded', status: 'in_payroll', destination_kind: 'supplemental', label: 'Accounting correction committed', destination: 'Supplemental payroll · Pay date unavailable' },
  { completion: null, status: 'scheduled', destination_kind: 'regular', label: 'Scheduled', destination: 'Regular payroll · Pay date unavailable' },
  { completion: null, status: 'open', destination_kind: 'unassigned', label: 'Needs review', destination: 'No destination assigned' },
])('renders truthful $label history without deriving a payday from the due date', async (item) => {
  const history = { ...period, settlement_cases: [{ ...item, target_pay_date: null, public_id: 'case', source_time_entry_id: '19', origin_reason: 'pending_overtime', target_external_pay_period_id: 'long-audit-payroll-reference', action_due_on: '2026-12-15' }] }
  mock.period.mockResolvedValue({ period: history, employee: { id: '7', payroll_integration_id: 'employee-uuid' }, integration: { source_instance_id: 'installation-uuid' } })
  renderEvidence(PERIOD)
  const notes = await screen.findByRole('region', { name: 'Reconciliation notes' })
  expect(within(notes).getByText(item.label)).toBeInTheDocument()
  expect(within(notes).getByText(item.destination)).toBeInTheDocument()
  expect(notes).toHaveTextContent('Historical reason: Overtime approval was pending at cutoff')
  expect(notes).toHaveTextContent('Recorded follow-up date: Tue, Dec 15, 2026')
  expect(notes).toHaveTextContent('Payroll reference: long-audit-payroll-reference')
  expect(within(notes).queryByText('Paid', { exact: true })).not.toBeInTheDocument()
  expect(within(notes).queryByText(/Pay date.*Dec 15/)).not.toBeInTheDocument()
})

it('describes receipt scope independently from commitment and keeps the operator note', async () => {
  const prepared = { ...period, coverage_lines: [{ ...period.coverage_lines[0], coverage_state: 'committed', receipt_scope: 'exact_line', identity_state: 'verified', reason: 'Chels kept this original note.' }] }
  mock.period.mockResolvedValue({ period: prepared, employee: { id: '7', payroll_integration_id: 'employee-uuid' }, integration: { source_instance_id: 'installation-uuid' } })
  renderEvidence(PERIOD)
  expect(await screen.findByText(/Original period hours · Payroll committed · no active issued coverage · REG 6h/)).toBeInTheDocument()
  expect(screen.getByText(/receipt Receipt for this saved line/)).toBeInTheDocument()
  expect(screen.getByText('Chels kept this original note.')).toBeInTheDocument()
  expect(screen.queryByText('Paid', { exact: true })).not.toBeInTheDocument()
})

it('keeps unknown coverage and identity unresolved without hiding signed hours', async () => {
  const unknown = { ...period, coverage_lines: [{ ...period.coverage_lines[0], source_kind: 'future_source', coverage_state: 'future_paid', identity_state: 'future_verified', receipt_scope: 'constructor', regular_hours: -1, overtime_hours: null }] }
  mock.period.mockResolvedValue({ period: unknown, employee: { id: '7', payroll_integration_id: 'employee-uuid' }, integration: { source_instance_id: 'installation-uuid' } })
  renderEvidence(PERIOD)
  expect(await screen.findByText('Source hours · source needs review · Coverage status needs review · REG -1h / OT Unknown')).toBeInTheDocument()
  expect(screen.getByText('Employee identity needs review')).toBeInTheDocument()
  expect(screen.getByText(/Receipt scope not recognized · line confirmation unavailable/)).toBeInTheDocument()
  expect(screen.queryByText(/future_paid|future_verified/)).not.toBeInTheDocument()
  expect(screen.queryByText('Paid', { exact: true })).not.toBeInTheDocument()
})

it.each([
  { receipt_scope: 'batch', coverage_state: 'receipt_review', scope: 'Batch receipt only · no line confirmation' },
  { receipt_scope: 'ambiguous_entry', coverage_state: 'receipt_review', scope: 'Entry receipt · saved line needs review' },
  { receipt_scope: 'none', coverage_state: 'exported', scope: 'No receipt recorded' },
])('keeps $receipt_scope coverage separate from paid case completion', async (line) => {
  const unconfirmed = { ...period, coverage_lines: [{ ...period.coverage_lines[0], ...line }] }
  mock.period.mockResolvedValue({ period: unconfirmed, employee: { id: '7', payroll_integration_id: 'employee-uuid' }, integration: { source_instance_id: 'installation-uuid' } })
  renderEvidence(PERIOD)
  const scope = await screen.findByText((content) => content.includes(`receipt ${line.scope} ·`))
  expect(scope).toBeInTheDocument()
  expect(screen.queryByText('Paid', { exact: true })).not.toBeInTheDocument()
  expect(screen.queryByText(/Original period hours · Issued payment coverage/)).not.toBeInTheDocument()
})

it.each([
  { identity_state: 'future_verified', receipt_scope: 'exact_line' },
  { identity_state: 'frozen_owner_mismatch', receipt_scope: 'exact_line' },
  { identity_state: 'verified', receipt_scope: 'batch' },
  { identity_state: 'verified', receipt_scope: 'ambiguous_entry' },
  { identity_state: 'verified', receipt_scope: 'future_exact_line' },
])('does not confirm issued coverage with contradictory $identity_state/$receipt_scope', async (context) => {
  const conflicting = { ...period, coverage_lines: [{ ...period.coverage_lines[0], coverage_state: 'issued', ...context }] }
  mock.period.mockResolvedValue({ period: conflicting, employee: { id: '7', payroll_integration_id: 'employee-uuid' }, integration: { source_instance_id: 'installation-uuid' } })
  renderEvidence(PERIOD)
  expect(await screen.findByText(/Original period hours · .*needs review.*coverage unconfirmed · REG 6h/)).toBeInTheDocument()
  expect(screen.queryByText(/Original period hours · Issued payment coverage/)).not.toBeInTheDocument()
  expect(screen.getByText(/payroll period 30 · item 99/)).toHaveTextContent('1001')
})

it('retains issued manual evidence without inventing a line receipt scope', async () => {
  const manual = { ...period, coverage_lines: [{ ...period.coverage_lines[0], source_kind: 'manual', identity_state: 'verified', receipt_scope: null }] }
  mock.period.mockResolvedValue({ period: manual, employee: { id: '7', payroll_integration_id: 'employee-uuid' }, integration: { source_instance_id: 'installation-uuid' } })
  renderEvidence(PERIOD)
  expect(await screen.findByText('Manually linked hours · Issued payment coverage · REG 6h / OT 0h')).toBeInTheDocument()
  expect(screen.getByText(/receipt Manually linked evidence/)).toBeInTheDocument()
  expect(screen.queryByText(/Receipt for this saved line/)).not.toBeInTheDocument()
})

it('requires review of issued original-period hours without a receipt scope', async () => {
  const missingScope = { ...period, coverage_lines: [{ ...period.coverage_lines[0], identity_state: 'verified', receipt_scope: null }] }
  mock.period.mockResolvedValue({ period: missingScope, employee: { id: '7', payroll_integration_id: 'employee-uuid' }, integration: { source_instance_id: 'installation-uuid' } })
  renderEvidence(PERIOD)
  expect(await screen.findByText('Original period hours · Receipt needs review · line coverage unconfirmed · REG 6h / OT 0h')).toBeInTheDocument()
  expect(screen.getByText(/receipt Receipt scope not recorded/)).toBeInTheDocument()
  expect(screen.queryByText(/Original period hours · Issued payment coverage/)).not.toBeInTheDocument()
  expect(screen.getByText(/payroll period 30 · item 99/)).toHaveTextContent('1001')
})
