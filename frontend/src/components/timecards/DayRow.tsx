import { useRef } from 'react'
import { ChevronRight } from 'lucide-react'
import type { TimeEntry } from '../../lib/api'
import { cx } from '../../lib/cx'
import { formatDateOnly } from '../../lib/dateUtils'
import { formatHours, hoursSince, isOpenClock, shortClock } from '../../lib/timecards'
import { Button, StatusPill, type StatusTone } from '../ui'
import { FixClockOutForm } from './FixClockOutForm'

export interface DayRowProps {
  date: string
  /** Guam today, YYYY-MM-DD. */
  today: string
  entries: TimeEntry[]
  categories: Array<{ id: number; name: string }>
  /** No taps open anything and no fix is offered (a former employee). */
  readOnly?: boolean
  /** The entry a link pointed at; its shift is highlighted. */
  highlightedEntryId?: number | null
  /** The open clock whose inline fix is showing. */
  fixingEntryId: number | null
  onFix: (entry: TimeEntry | null) => void
  onOpen: (entry: TimeEntry) => void
  onSaved: () => void
}

function statusFor(entry: TimeEntry, today: string): { tone: StatusTone; label: string } {
  if (isOpenClock(entry)) return entry.work_date < today ? { tone: 'needs-fix', label: 'No clock-out' } : { tone: 'info', label: 'On the clock' }
  if (entry.approval_status === 'denied') return { tone: 'needs-fix', label: 'Denied' }
  if (entry.approval_status === 'pending') return { tone: 'waiting', label: 'Waiting' }
  return { tone: 'approved', label: 'Approved' }
}

/**
 * One day of a pay period: a thin "Day off" line, the day's shifts, or a
 * forgotten clock with its fix in place. An article labelled with its date.
 */
export function DayRow({ date, today, entries, categories, readOnly = false, highlightedEntryId, fixingEntryId, onFix, onOpen, onSaved }: DayRowProps) {
  const articleRef = useRef<HTMLElement>(null)
  const weekday = formatDateOnly(date, { weekday: 'short' })
  const label = formatDateOnly(date, { weekday: 'long', month: 'long', day: 'numeric' })

  const dateColumn = (
    <div className="w-11 shrink-0 text-center leading-tight" aria-hidden="true">
      <p className="text-caption font-semibold text-ink-muted">{weekday}</p>
      <p className="text-body font-semibold tabular-nums text-ink">{Number(date.slice(8))}</p>
    </div>
  )

  if (entries.length === 0) {
    return (
      <article ref={articleRef} aria-label={label} className="flex min-h-11 items-center gap-3 px-3.5 py-1.5 pointer-fine:min-h-10 pointer-fine:px-4">
        {dateColumn}
        <p className="text-body-sm text-ink-subtle">{date === today ? 'No time yet today' : 'Day off'}</p>
      </article>
    )
  }

  // Back to the day after the inline fix closes, so keyboard users don't lose their place.
  const closeFix = (saved: boolean) => {
    onFix(null)
    if (saved) onSaved()
    requestAnimationFrame(() => articleRef.current?.focus())
  }

  const fixingEntry = entries.find(entry => entry.id === fixingEntryId)
  return (
    <article ref={articleRef} tabIndex={-1} aria-label={label} className="px-3.5 py-2 outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary pointer-fine:px-4">
      <div className="flex gap-3">
        <div className="pt-2.5">{dateColumn}</div>
        <div className="min-w-0 flex-1 space-y-1">
          {entries.map((entry) => {
            const status = statusFor(entry, today)
            const highlighted = highlightedEntryId === entry.id
            const forgotten = isOpenClock(entry) && entry.work_date < today

            if (forgotten) {
              const fixing = fixingEntryId === entry.id
              return (
                <div key={entry.id} id={`timecard-entry-${entry.id}`} className={cx('rounded-control bg-amber-50 px-3 py-2.5', highlighted && 'ring-2 ring-inset ring-amber-400')}>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-body font-semibold text-ink pointer-fine:text-body-sm">
                        {shortClock(entry.formatted_start_time)} – <span className="text-amber-900">no clock-out</span>
                      </p>
                      <p className="text-body-sm text-ink-muted">
                        {[entry.time_category?.name, entry.clock_in_at && `still clocked in ${formatHours(hoursSince(entry.clock_in_at))}`].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                    {!readOnly && !fixing && <Button size="sm" onClick={() => onFix(entry)}>Fix clock-out</Button>}
                    {readOnly && <StatusPill tone={status.tone}>{status.label}</StatusPill>}
                  </div>
                </div>
              )
            }

            const range = entry.formatted_end_time
              ? `${shortClock(entry.formatted_start_time)}–${shortClock(entry.formatted_end_time)}`
              : `${shortClock(entry.formatted_start_time)} – on the clock`
            const content = (
              <>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body font-medium text-ink pointer-fine:text-body-sm">{range}</span>
                  <span className="block truncate text-body-sm text-ink-muted">
                    {[entry.time_category?.name ?? 'No work category', entry.entry_method === 'manual' && 'added'].filter(Boolean).join(' · ')}
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  <span className="text-body-sm font-semibold tabular-nums text-ink">{entry.status === 'completed' ? formatHours(entry.hours) : ''}</span>
                  <span className="flex gap-1">
                    {entry.overtime_status === 'pending' && <StatusPill tone="waiting">OT waiting</StatusPill>}
                    <StatusPill tone={status.tone}>{status.label}</StatusPill>
                  </span>
                </span>
              </>
            )
            const rowClass = cx('flex w-full items-center gap-3 rounded-control px-2 py-1.5 text-left', highlighted && 'bg-cyan-50 ring-2 ring-inset ring-cyan-400')
            return readOnly ? (
              <div key={entry.id} id={`timecard-entry-${entry.id}`} className={rowClass}>{content}</div>
            ) : (
              <button
                key={entry.id}
                id={`timecard-entry-${entry.id}`}
                type="button"
                onClick={() => onOpen(entry)}
                aria-label={`${range}, ${entry.time_category?.name ?? 'no work category'}, ${entry.status === 'completed' ? formatHours(entry.hours) : 'on the clock'}, ${status.label}. Edit shift`}
                className={cx(rowClass, 'min-h-11 hover:bg-surface-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary')}
              >
                {content}
                <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-ink-subtle" />
              </button>
            )
          })}
        </div>
      </div>
      {/* Full width under the day, so the fields have room on a phone. */}
      {fixingEntry && !readOnly && <FixClockOutForm entry={fixingEntry} categories={categories} onCancel={() => closeFix(false)} onSaved={() => closeFix(true)} onReload={() => closeFix(true)} />}
    </article>
  )
}
