import { Fragment, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronDown, ChevronRight, Download } from 'lucide-react'
import type { PayrollBatchAdjustment, PayrollBatchPayload } from '../../lib/api'
import { cx } from '../../lib/cx'
import { employeeWorkspaceHref } from '../../lib/employeeWorkspace'
import { LIFECYCLE_LABELS } from '../../lib/payrollTerms'
import { useMediaQuery } from '../../lib/useMediaQuery'
import { Button, StatusPill } from '../ui'
import { dayLabel, hoursLabel, plural } from '../today/format'
import { StaleNote } from '../today/StaleNote'
import { personRows, type PersonRow } from './payPeriodModel'

const HELD_LABELS: Record<string, string> = {
  pending_approval: LIFECYCLE_LABELS.awaiting_approval,
  pending_overtime: 'Overtime waiting',
  open_clock: 'Still clocked in',
  denied_approval: LIFECYCLE_LABELS.not_payable,
  denied_overtime: 'Overtime denied',
  pending_payment_attestation: LIFECYCLE_LABELS.payment_attested_pending_evidence,
}

const SOURCE_LABELS: Record<PayrollBatchAdjustment['source_kind'], string | null> = {
  current: null,
  carryover: 'Late hours',
  correction: 'Correction to an earlier payroll',
}

/** On a locked period the flags describe the lock, not now: that time may have been approved since. */
function Flags({ row, locked }: { row: PersonRow; locked: boolean }) {
  return (
    <>
      {row.stillClockedIn && <StatusPill tone={locked ? 'off' : 'needs-fix'}>{locked ? 'Clocked in at the lock' : 'Still clocked in'}</StatusPill>}
      {row.overtimeWaiting > 0 && <StatusPill tone={locked ? 'off' : 'waiting'}>{hoursLabel(row.overtimeWaiting)} OT {locked ? 'held back at the lock' : 'waiting'}</StatusPill>}
      {row.missingCategory && <StatusPill tone="needs-fix">No work category</StatusPill>}
    </>
  )
}

function Days({ row, highlight }: { row: PersonRow; highlight: string | null }) {
  const lines = [...row.lines].sort((a, b) => a.original_work_date.localeCompare(b.original_work_date))
  return (
    <ul className="space-y-1 text-body-sm">
      {lines.map(line => {
        const source = SOURCE_LABELS[line.source_kind]
        return (
          <li
            key={`${line.source_time_entry_id}-${line.line_key}`}
            className={cx('flex flex-wrap items-baseline justify-between gap-x-3 rounded-control px-2 py-1', highlight === line.source_time_entry_id && 'bg-primary/5 ring-2 ring-primary')}
          >
            <span className="min-w-0">
              {dayLabel(line.original_work_date)} · {line.category?.name ?? 'No work category'}
              {source && <span className="text-ink-muted"> · {source}</span>}
            </span>
            <span className="tabular-nums text-ink-muted">
              {hoursLabel(line.regular_hours)} regular{line.overtime_hours ? ` · ${hoursLabel(line.overtime_hours)} OT` : ''}
            </span>
          </li>
        )
      })}
      {row.held.map(item => (
        <li key={`${item.source_time_entry_id}-${item.reason}`} className="flex flex-wrap items-baseline justify-between gap-x-3 px-2 py-1 text-ink-muted">
          <span className="min-w-0">{dayLabel(item.original_work_date)} · {HELD_LABELS[item.reason] ?? 'Held back'}</span>
          <span className="tabular-nums">{hoursLabel(item.held_total_hours)}</span>
        </li>
      ))}
    </ul>
  )
}

export interface WhatGoesToPayrollProps {
  payload: PayrollBatchPayload
  /** Frozen at the lock, or a live "if it locked now" preview. */
  locked: boolean
  /** Opens this person's row (`?user_id=` from older links). */
  initialOpen?: string | null
  /** Highlights one shift (`?entry_id=`). */
  highlightEntry?: string | null
  returnTo: string
  exporting: string | null
  onExport: (kind: 'pdf' | 'csv' | 'locked_csv') => void
  /** When the last good answer arrived, if the latest refresh failed. */
  staleSince?: Date | null
  onRetry?: () => void
}

/** Per person: approved regular and overtime, still waiting, and the days behind them on request. */
export function WhatGoesToPayroll({ payload, locked, initialOpen = null, highlightEntry = null, returnTo, exporting, onExport, staleSince, onRetry }: WhatGoesToPayrollProps) {
  // A locked period lists only people whose hours went; shifts held back at the lock show under carried hours.
  const rows = personRows(payload).filter(row => !locked || row.lines.length > 0)
  const wide = useMediaQuery('(min-width: 640px)')
  const [open, setOpen] = useState<Set<string>>(() => new Set(initialOpen ? [initialOpen] : []))
  const toggle = (id: string) => setOpen(current => {
    const next = new Set(current)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })
  const totals = rows.reduce((sum, row) => ({ regular: sum.regular + row.regular, overtime: sum.overtime + row.overtime, waiting: sum.waiting + row.waiting }), { regular: 0, overtime: 0, waiting: 0 })
  const paid = rows.filter(row => row.regular + row.overtime > 0).length
  const title = locked ? 'What went to payroll' : 'What goes to payroll'
  const caption = locked ? 'What AIRE sent to payroll at the lock' : 'What goes to payroll if it locked now'
  const personHref = (row: PersonRow) => employeeWorkspaceHref(row.id, { tab: 'pay', period: payload.start_date, returnTo })

  return (
    <section aria-labelledby="what-goes-to-payroll" className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h2 id="what-goes-to-payroll" className="text-body font-semibold text-ink">
          {title}
          <span className="font-normal text-ink-muted"> · {locked ? '' : 'if it locked now · '}{plural(paid, 'person', 'people')}</span>
        </h2>
        <p className="text-caption text-ink-muted">Overtime counts only once approved.</p>
      </div>
      {staleSince !== undefined && onRetry && <StaleNote what={locked ? 'what went to payroll' : 'what goes to payroll'} loadedAt={staleSince} onRetry={onRetry} />}

      {rows.length === 0 ? (
        <p className="rounded-card border border-line bg-surface px-4 py-6 text-center text-body-sm text-ink-muted">No hours in this pay period yet.</p>
      ) : wide ? (
        <div className="overflow-x-auto rounded-card border border-line bg-surface">
          <table className="w-full text-body-sm">
            <caption className="sr-only">{caption}</caption>
            <thead className="border-b border-line text-left text-caption text-ink-muted">
              <tr>
                <th scope="col" className="px-3.5 py-2 font-medium">Person</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Approved regular</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Approved overtime</th>
                {!locked && <th scope="col" className="px-3 py-2 text-right font-medium">Still waiting</th>}
                <th scope="col" className="w-12 px-2 py-2"><span className="sr-only">Days</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map(row => {
                const expanded = open.has(row.id)
                return (
                  <Fragment key={row.id}>
                    <tr>
                      <th scope="row" className="px-3.5 py-2 text-left font-normal">
                        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <Link to={personHref(row)} className="font-semibold text-ink hover:underline">{row.name}</Link>
                          <Flags row={row} locked={locked} />
                        </span>
                      </th>
                      <td className="px-3 py-2 text-right tabular-nums">{hoursLabel(row.regular)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{hoursLabel(row.overtime)}</td>
                      {!locked && <td className={cx('px-3 py-2 text-right tabular-nums', row.waiting > 0 ? 'text-amber-900' : 'text-ink-subtle')}>{hoursLabel(row.waiting)}</td>}
                      <td className="px-2 py-1 text-right">
                        <button
                          type="button"
                          aria-expanded={expanded}
                          aria-label={`${expanded ? 'Hide' : 'Show'} ${row.name}'s days`}
                          onClick={() => toggle(row.id)}
                          className="inline-grid size-11 place-items-center rounded-control text-ink-muted hover:bg-surface-muted pointer-fine:size-9"
                        >
                          {expanded ? <ChevronDown aria-hidden="true" className="size-4" /> : <ChevronRight aria-hidden="true" className="size-4" />}
                        </button>
                      </td>
                    </tr>
                    {expanded && (
                      <tr>
                        <td colSpan={locked ? 4 : 5} className="bg-surface-muted px-3.5 py-2"><Days row={row} highlight={highlightEntry} /></td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
            <tfoot className="border-t border-line-strong font-semibold">
              <tr>
                <th scope="row" className="px-3.5 py-2 text-left">Total</th>
                <td className="px-3 py-2 text-right tabular-nums">{hoursLabel(totals.regular)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{hoursLabel(totals.overtime)}</td>
                {!locked && <td className="px-3 py-2 text-right tabular-nums">{hoursLabel(totals.waiting)}</td>}
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      ) : (
        <ul aria-label={caption} className="divide-y divide-line rounded-card border border-line bg-surface">
          {rows.map(row => {
            const expanded = open.has(row.id)
            return (
              <li key={row.id}>
                <button
                  type="button"
                  aria-expanded={expanded}
                  onClick={() => toggle(row.id)}
                  className="flex min-h-14 w-full items-center gap-2 px-3.5 py-2 text-left"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold text-ink">{row.name}</span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-body-sm text-ink-muted">
                      <span className="tabular-nums">{hoursLabel(row.regular + row.overtime)} approved</span>
                      {!locked && row.waiting > 0 && <span className="tabular-nums text-amber-900">{hoursLabel(row.waiting)} waiting</span>}
                      <Flags row={row} locked={locked} />
                    </span>
                  </span>
                  {expanded ? <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-ink-muted" /> : <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-ink-muted" />}
                </button>
                {expanded && (
                  <div className="space-y-1 px-3.5 pb-3">
                    <Days row={row} highlight={highlightEntry} />
                    <Link to={personHref(row)} className="inline-flex min-h-11 items-center text-body-sm font-semibold text-primary underline">Open {row.name}</Link>
                  </div>
                )}
              </li>
            )
          })}
          <li className="flex justify-between px-3.5 py-3 text-body-sm font-semibold">
            <span>Total</span>
            <span className="tabular-nums">
              {hoursLabel(totals.regular + totals.overtime)} approved{!locked && totals.waiting > 0 ? ` · ${hoursLabel(totals.waiting)} waiting` : ''}
            </span>
          </li>
        </ul>
      )}

      {/* The live hours report follows the dates, not payroll's rules, so it's labelled apart from what payroll gets. */}
      <div className="space-y-2 pt-1">
        {locked && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Button size="sm" icon={<Download className="size-4" />} loading={exporting === 'locked_csv'} loadingLabel="Preparing CSV…" disabled={exporting !== null} onClick={() => onExport('locked_csv')}>What was sent to payroll (CSV)</Button>
            <span className="text-caption text-ink-muted">The hours AIRE froze at the lock, as in this table.</span>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" icon={<Download className="size-4" />} loading={exporting === 'pdf'} loadingLabel="Preparing PDF…" disabled={exporting !== null} onClick={() => onExport('pdf')}>Hours report (live) PDF</Button>
          <Button variant="secondary" size="sm" icon={<Download className="size-4" />} loading={exporting === 'csv'} loadingLabel="Preparing CSV…" disabled={exporting !== null} onClick={() => onExport('csv')}>Hours report (live) CSV</Button>
        </div>
        <p className="text-caption text-ink-muted">
          The live hours report lists the approved shifts dated {locked ? 'in this period as they are now' : 'in this period'}. It can differ from {locked ? 'what was sent' : 'this table'}: late hours carried in{locked ? ', later edits' : ''} and held-back time aren't counted the same way.
        </p>
      </div>
    </section>
  )
}
