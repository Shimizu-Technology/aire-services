import type { TimeEntry } from '../../lib/api'
import { clockTime, employeeWeekTotals } from '../../lib/myTime'
import {
  employeeDate,
  employeeShiftStatus,
} from '../../lib/employeePresentation'
import { Button, Sheet } from '../ui'

export function ShiftSheet({
  entry,
  weekEntries,
  weekUnavailable,
  onClose,
  onFix,
  onRemove,
}: {
  entry: TimeEntry
  weekEntries: TimeEntry[]
  weekUnavailable: boolean
  onClose: () => void
  onFix: () => void
  /** Only for time the viewer added that is still waiting. */
  onRemove?: () => void
}) {
  const source =
    entry.entry_method === 'manual'
      ? 'Added manually'
      : entry.clock_source === 'kiosk'
        ? 'Kiosk'
        : entry.clock_source === 'admin'
          ? 'Admin'
          : entry.clock_source === 'mobile'
            ? 'Phone'
            : 'Clock'
  const week = employeeWeekTotals(weekEntries, entry.work_date)
  return (
    <Sheet
      open
      onClose={onClose}
      title={employeeDate(entry.work_date, {
        weekday: 'long',
        month: 'short',
        day: 'numeric',
      })}
      footer={
        entry.status === 'completed' ? (
          <div className="space-y-2">
            <Button fullWidth variant="secondary" onClick={onFix}>
              Ask for a fix
            </Button>
            {onRemove && (
              <Button fullWidth variant="ghost" onClick={onRemove}>
                Remove this shift
              </Button>
            )}
          </div>
        ) : undefined
      }
    >
      <dl className="space-y-4 text-body">
        <div>
          <dt className="text-ink-muted">Clock in · {source}</dt>
          <dd>
            {entry.clock_in_at
              ? clockTime(entry.clock_in_at)
              : (entry.formatted_start_time ?? entry.start_time ?? '—')}
          </dd>
        </div>
        <div>
          <dt className="text-ink-muted">Clock out · {source}</dt>
          <dd>
            {entry.clock_out_at
              ? clockTime(entry.clock_out_at)
              : (entry.formatted_end_time ??
                entry.end_time ??
                'Still on the clock')}
          </dd>
        </div>
        <div>
          <dt className="text-ink-muted">Breaks</dt>
          <dd>{entry.break_minutes ?? 0} minutes</dd>
          {entry.breaks.map((row) => (
            <dd key={row.id}>
              {clockTime(row.start_time)}–
              {row.end_time ? clockTime(row.end_time) : 'In progress'}
            </dd>
          ))}
        </div>
        <div>
          <dt className="text-ink-muted">Work</dt>
          <dd>{entry.time_category?.name ?? 'No work type'}</dd>
        </div>
        <div>
          <dt className="text-ink-muted">Hours</dt>
          <dd>{entry.hours.toFixed(1)}h</dd>
        </div>
        <div>
          <dt className="text-ink-muted">Approval</dt>
          <dd>
            {entry.approval_status === 'denied'
              ? entry.approved_by
                ? `Declined by ${entry.approved_by.full_name}`
                : 'Declined'
              : entry.approval_status === 'approved' && entry.approved_by
                ? `Approved by ${entry.approved_by.full_name}`
                : entry.approval_status === 'approved' && entry.auto_approved
                  ? 'Automatically approved'
                  : employeeShiftStatus(entry).label}
          </dd>
        </div>
        <div>
          <dt className="text-ink-muted">Week containing this shift</dt>
          <dd>
            {weekUnavailable
              ? "Week totals haven't loaded."
              : `${week.hours.toFixed(1)}h worked · ${week.overtime.toFixed(1)}h overtime waiting`}
          </dd>
        </div>
        {entry.approval_note && (
          <div>
            <dt className="text-ink-muted">Manager's note</dt>
            <dd>{entry.approval_note}</dd>
          </div>
        )}
        {entry.description && (
          <div>
            <dt className="text-ink-muted">Note</dt>
            <dd>{entry.description}</dd>
          </div>
        )}
      </dl>
      {entry.status === 'completed' && (
        <p className="mt-5 text-body-sm text-ink-muted">
          Something wrong? Ask for a fix and say what happened. Your manager
          approves the change.
        </p>
      )}
    </Sheet>
  )
}
