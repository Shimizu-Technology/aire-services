import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ACCOUNTING_CORRECTION_LABEL, ACCOUNTING_CORRECTION_NOTE } from '../../lib/accountingCorrection'
import { formatWorkDate } from '../../lib/dateUtils'
import { employeeEvidenceApi, type EmployeeEvidence, type EvidencePeriod } from '../../lib/employeeEvidenceApi'
import { coverageStateLabel, historicalReasonLabel, identityStateLabel, receiptScopeLabel, settlementStatusLabel, sourceKindLabel } from '../../lib/employeeEvidenceLabels'
import { PERSON_TOTAL_LABELS, type PersonTotal } from '../../lib/payrollTerms'
import { Button, ErrorState } from '../ui'
import { Skeleton } from '../ui/Skeleton'
import { useLoadable } from './useLoadable'

const h = (value: number) => `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}h`

type SettlementCaseEvidence = NonNullable<EvidencePeriod['settlement_cases']>[number]
function caseStatus(item: SettlementCaseEvidence) {
  if (item.completion === 'paid') return 'Paid'
  if (item.completion === 'accounting_recorded') return ACCOUNTING_CORRECTION_LABEL
  return settlementStatusLabel(item.status)
}
function destinationLabel(kind: string) {
  const destinations: Record<string, string> = {
    regular: 'Regular payroll', supplemental: 'Supplemental payroll', unassigned: 'No destination assigned', not_payable: 'Not payable',
  }
  return destinations[kind] || kind.replaceAll('_', ' ')
}

interface PeriodEvidenceProps {
  userId: number
  period: EvidencePeriod
  /** The person's payroll identity from the periods list; the detail must match it. */
  identity: Pick<EmployeeEvidence, 'employee' | 'integration'>
  /** Not-matched hours count only after payday on a locked period. */
  showNotMatched: boolean
  /** A shift to open first (a link with `?entry=`). */
  focusEntryId?: string | null
  /** The Time tab for a shift in this period. */
  shiftHref: (entryId: string) => string
}

/**
 * The saved payroll evidence for one locked pay period: totals, each shift,
 * the lines payroll covered, and follow-ups. For reconciling with Cornerstone.
 */
export function PeriodEvidence({ userId, period, identity, showNotMatched, focusEntryId = null, shiftHref }: PeriodEvidenceProps) {
  const [cursor, setCursor] = useState('')
  const [retry, setRetry] = useState(0)
  const [openEntry, setOpenEntry] = useState<string | null>(focusEntryId)

  const loaded = useLoadable(`${userId}:${period.id}:${cursor}:${retry}`, async (signal) => {
    const filter = new URLSearchParams()
    if (cursor) filter.set('detail_cursor', cursor)
    const result = await employeeEvidenceApi.period(String(userId), period.id, filter, signal)
    if (result.period.id !== period.id || result.employee.id !== String(userId) || result.employee.payroll_integration_id !== identity.employee.payroll_integration_id || result.integration.source_instance_id !== identity.integration.source_instance_id) {
      throw new Error('Period evidence identity changed. Reload the page before continuing.')
    }
    return result.period
  }, 'Unable to load this period.')
  const detail = loaded.status === 'ready' ? loaded.value : null
  const error = loaded.status === 'error' ? loaded.message : null

  const totals = period.summary
  const rows: Array<[PersonTotal, number]> = [
    ['worked', totals.worked_hours],
    ['approved', totals.eligible_hours],
    ['paid', totals.issued_hours],
    ['inRun', totals.committed_hours],
    ['sent', totals.exported_hours],
    ['onHold', totals.held_hours],
    ...(totals.accounting_correction_hours ? [['correction', totals.accounting_correction_hours] as [PersonTotal, number]] : []),
    ...(showNotMatched ? [['notMatched', totals.needs_reconciliation_hours] as [PersonTotal, number]] : []),
  ]

  return (
    <div className="space-y-4 text-body-sm">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
        {rows.map(([key, value]) => (
          <div key={key} className="min-w-0">
            <dt className="text-ink-muted">{PERSON_TOTAL_LABELS[key]}</dt>
            <dd className="font-semibold tabular-nums text-ink">{h(Number(value))}</dd>
          </div>
        ))}
      </dl>
      {!!totals.unissued_correction_count && <p className="text-amber-900">{totals.unissued_correction_count} signed correction lines await issuance, including classification changes with zero net hours.</p>}
      {!!totals.identity_review_count && <p className="text-amber-900">{totals.identity_review_count} retained evidence lines need employee identity review. Frozen identities have been preserved.</p>}
      {!!totals.uncategorized_entry_count && <p className="text-amber-900">{totals.uncategorized_entry_count} entries need a work category.</p>}
      {!!totals.retained_uncategorized_line_count && <p className="text-amber-900">{totals.retained_uncategorized_line_count} retained frozen lines need work category reconciliation. Saved categories have been preserved.</p>}
      {!!totals.receipt_review_count && <p className="text-amber-900">{totals.receipt_review_count} retained lines have batch-only or ambiguous receipt evidence. Exact line coverage needs reconciliation.</p>}

      {error ? (
        <ErrorState title="Couldn't load this period's evidence." description={error} onRetry={() => setRetry(value => value + 1)} />
      ) : !detail ? (
        <div aria-busy="true" aria-label="Loading this period's evidence" className="space-y-2">
          <Skeleton height={20} className="w-2/3" />
          <Skeleton height={56} className="w-full" />
        </div>
      ) : (
        <>
          {detail.detail_pagination && <p className="text-caption text-ink-subtle">Detail page {Math.floor(detail.detail_pagination.offset / detail.detail_pagination.per_page) + 1} · {detail.detail_pagination.counts.entries} entries, {detail.detail_pagination.counts.coverage_lines} coverage lines. Period totals include every page.</p>}
          <section aria-label="Shifts">
            <h4 className="font-semibold text-ink">Shifts</h4>
            {!detail.entries?.length && !detail.detail_pagination?.counts.entries && <p className="mt-2 text-ink-muted">Current entries are absent; retained payroll evidence remains below.</p>}
            <ul className="mt-2 space-y-2">
              {detail.entries?.map((entry) => (
                <li key={entry.id} className={`rounded-control border p-3 ${openEntry === entry.id ? 'border-primary bg-primary/5' : 'border-line'}`}>
                  <button
                    type="button"
                    aria-expanded={openEntry === entry.id}
                    onClick={() => setOpenEntry(openEntry === entry.id ? null : entry.id)}
                    className="min-h-11 text-left font-semibold text-primary hover:underline"
                  >
                    {entry.work_date} · {entry.start_time || '—'} – {entry.end_time || '—'} · {h(entry.worked_hours)}
                  </button>
                  <p className="mt-1 text-ink-muted">{entry.category || 'Uncategorized'} · {entry.auto_approved ? 'Auto-approved' : entry.approval_status || (entry.status === 'completed' ? 'Standard clock entry' : entry.status)} · REG {h(entry.regular_hours)} / OT {h(entry.overtime_hours)}</p>
                  <p className="mt-1 text-caption text-ink-muted">Issued coverage {h(entry.issued_hours)} · committed {h(entry.committed_hours)}{showNotMatched ? ` · not matched ${h(entry.needs_reconciliation_hours)}` : ''}</p>
                  {openEntry === entry.id && (
                    <div className="mt-2 space-y-2">
                      <p className="[overflow-wrap:anywhere]">{entry.description || 'No description recorded.'}</p>
                      {entry.payment_attestation && <p>On hold: {entry.payment_attestation}</p>}
                      <Link className="inline-flex min-h-11 items-center font-semibold text-primary hover:underline" to={shiftHref(entry.id)}>Show on the timecard</Link>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>

          <section aria-label="Saved source coverage">
            <h4 className="font-semibold text-ink">Saved source coverage</h4>
            <p className="mt-1 text-caption text-ink-muted">Signed correction lines are retained. Source REG/OT describes covered time; actual paycheck components and money are available in payroll.</p>
            {!detail.coverage_lines?.length && !detail.detail_pagination?.counts.coverage_lines && <p className="mt-2 text-ink-muted">No linked payroll coverage. Reconcile payment evidence before deciding whether payment is owed.</p>}
            <ul className="mt-2 space-y-2">
              {detail.coverage_lines?.filter((line) => !openEntry || line.source_time_entry_id === openEntry).map((line) => (
                <li key={line.id} className="rounded-control border border-line p-3">
                  <p className="font-semibold">{sourceKindLabel(line.source_kind)} · {line.accounting_only && line.status === 'committed' ? ACCOUNTING_CORRECTION_LABEL : coverageStateLabel(line.coverage_state, line.identity_state, line.receipt_scope, line.source_kind === 'manual')} · REG {line.regular_hours === null ? 'Unknown' : h(line.regular_hours)} / OT {line.overtime_hours === null ? 'Unknown' : h(line.overtime_hours)}</p>
                  <p className="mt-1 text-ink-muted [overflow-wrap:anywhere]">Work {line.work_date} · receipt {line.receipt_scope ? receiptScopeLabel(line.receipt_scope) : line.source_kind === 'manual' ? 'Manually linked evidence' : 'Receipt scope not recorded'} · payroll period {line.external_pay_period_id || 'Not linked'} · item {line.external_payroll_item_id || 'Not linked'}{line.accounting_only ? '' : ` · ${line.payment_method === 'direct_deposit' ? 'bank transfer' : line.payment_method === 'paper_check' ? 'check' : 'payment reference'} ${line.payment_reference || 'Not recorded'}`}</p>
                  {line.accounting_only && <p className="mt-2 text-sky-900">{ACCOUNTING_CORRECTION_NOTE} · disposition {line.accounting_correction?.correction_disposition_id}</p>}
                  {line.status === 'payment_cancelled' && <p className="mt-2 text-amber-900">Payment cancelled. Payroll remains committed and these hours stay reserved for the replacement.</p>}
                  {line.identity_state && line.identity_state !== 'verified' && <p className="mt-2 text-amber-900">{identityStateLabel(line.identity_state)}</p>}
                  {line.source_category_id === null && <p className="mt-2 text-amber-900">Frozen work category is unavailable; needs reconciliation.</p>}
                  {line.reason && <p className="mt-2 [overflow-wrap:anywhere]">{line.reason}</p>}
                  {line.batch_id && <Link className="mt-1 inline-flex min-h-11 items-center font-semibold text-primary hover:underline" to={`/admin/payroll?${new URLSearchParams({ batch_id: line.batch_id, entry_id: line.source_time_entry_id })}`}>Open frozen batch</Link>}
                </li>
              ))}
            </ul>
          </section>

          {!!detail.settlement_cases?.length && (
            <section aria-label="Reconciliation notes">
              <h4 className="font-semibold text-ink">Reconciliation notes</h4>
              <ul className="mt-2 space-y-2">
                {detail.settlement_cases.map((item) => (
                  <li key={item.public_id} className="space-y-1 rounded-control border border-line p-3">
                    <p className="font-semibold text-ink">{caseStatus(item)}</p>
                    <p className="text-ink-muted">Historical reason: {historicalReasonLabel(item.origin_reason)}</p>
                    <p className="text-ink">{destinationLabel(item.destination_kind)}{item.target_pay_date ? ` · Pay date ${formatWorkDate(item.target_pay_date)}` : ['regular', 'supplemental'].includes(item.destination_kind) ? ' · Pay date unavailable' : ''}</p>
                    <p className="text-caption text-ink-subtle">Recorded follow-up date: {formatWorkDate(item.action_due_on)}</p>
                    <p className="text-caption text-ink-subtle [overflow-wrap:anywhere]">Recorded case status: {settlementStatusLabel(item.status)}{item.target_external_pay_period_id ? ` · Payroll reference: ${item.target_external_pay_period_id}` : ''}</p>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {detail.detail_pagination && (cursor || detail.detail_pagination.next_cursor) && (
            <div className="flex gap-2">
              {cursor && <Button variant="secondary" size="sm" onClick={() => setCursor('')}>First detail page</Button>}
              {detail.detail_pagination.next_cursor && <Button variant="secondary" size="sm" onClick={() => setCursor(detail.detail_pagination?.next_cursor || '')}>Next detail page</Button>}
            </div>
          )}
        </>
      )}
    </div>
  )
}
