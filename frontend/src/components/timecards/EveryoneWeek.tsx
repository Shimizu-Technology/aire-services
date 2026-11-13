import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { TimeEntry } from '../../lib/api'
import { timecardsApi } from '../../lib/api/timecards'
import { addDateDays, businessDateISO, businessWeekStart, formatDateOnly } from '../../lib/dateUtils'
import { formatHours, personName } from '../../lib/timecards'
import EditTimeEntryModal from '../time-tracking/EditTimeEntryModal'
import WeekGrid from '../time-tracking/WeekGrid'
import { Button, ErrorState, IconButton } from '../ui'
import { Skeleton } from '../ui/Skeleton'

export interface EveryoneWeekProps {
  /** Any day in the week to show, YYYY-MM-DD. */
  date: string
  onDateChange: (date: string) => void
  categories: Array<{ id: number; name: string }>
  refreshKey?: number
  onChanged?: () => void
  /** A person with several shifts on one day: open their timecard. */
  onOpenPerson: (userId: number, date: string) => void
  /** "+ Add" under a day. */
  onAddEntry: (date: string) => void
  addDisabled?: boolean
}

/** Everyone's week on the existing grid, with the week stepper above it. */
export function EveryoneWeek({ date, onDateChange, categories, refreshKey = 0, onChanged, onOpenPerson, onAddEntry, addDisabled = false }: EveryoneWeekProps) {
  const weekStart = businessWeekStart(date)
  const [revision, setRevision] = useState(0)
  const [state, setState] = useState<{ key: string; entries: TimeEntry[] | null; error: string | null }>({ key: '', entries: null, error: null })
  const [editing, setEditing] = useState<TimeEntry | null>(null)
  const requestKey = `${weekStart}:${refreshKey}:${revision}`
  const loaded = state.key === requestKey

  useEffect(() => {
    let cancelled = false
    void timecardsApi.teamWeek(weekStart).then((response) => {
      if (!cancelled) setState({ key: requestKey, entries: response.data ?? null, error: response.data ? null : response.error ?? "Couldn't load the week." })
    })
    return () => { cancelled = true }
  }, [requestKey, weekStart])

  const weekDates = useMemo(() => Array.from({ length: 7 }, (_, index) => addDateDays(weekStart, index)), [weekStart])
  // Like the old Timecards page: denied shifts stay out of the grid.
  const entries = useMemo(() => (loaded ? state.entries ?? [] : []).filter(entry => entry.approval_status !== 'denied'), [loaded, state.entries])
  const entriesByDate = useMemo(() => entries.reduce<Record<string, TimeEntry[]>>((days, entry) => {
    (days[entry.work_date] ??= []).push(entry)
    return days
  }, {}), [entries])
  const hoursPerDay = useMemo(() => Object.fromEntries(weekDates.map(day => [day, (entriesByDate[day] ?? []).reduce((sum, entry) => sum + entry.hours, 0)])), [entriesByDate, weekDates])
  const total = entries.reduce((sum, entry) => sum + entry.hours, 0)
  const today = businessDateISO()
  const label = `${formatDateOnly(weekDates[0], { month: 'short', day: 'numeric' })} – ${formatDateOnly(weekDates[6], { month: 'short', day: 'numeric', year: 'numeric' })}`

  return (
    <section aria-label="Everyone's week" className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <IconButton label="Previous week" icon={<ChevronLeft className="size-5" />} variant="secondary" onClick={() => onDateChange(addDateDays(weekStart, -7))} />
        <p aria-live="polite" className="min-w-0 px-1 text-body-sm text-ink-muted">
          <span className="font-semibold tabular-nums text-ink">{label}</span>
          {loaded && !state.error && <> · {formatHours(total)}</>}
        </p>
        <IconButton label="Next week" icon={<ChevronRight className="size-5" />} variant="secondary" disabled={addDateDays(weekStart, 7) > today} onClick={() => onDateChange(addDateDays(weekStart, 7))} />
        {!weekDates.includes(today) && <Button variant="ghost" size="sm" onClick={() => onDateChange(today)}>This week</Button>}
      </div>
      {!loaded ? (
        <div aria-busy="true" aria-label="Loading the week" className="grid grid-cols-7 gap-2 rounded-card border border-line bg-surface p-3">
          {Array.from({ length: 7 }, (_, index) => <Skeleton key={index} height={120} className="w-full" />)}
        </div>
      ) : state.error ? (
        <ErrorState title="Couldn't load the week." description={state.error} onRetry={() => setRevision(value => value + 1)} />
      ) : (
        <WeekGrid
          weekDates={weekDates}
          entriesByDate={entriesByDate}
          hoursPerDay={hoursPerDay}
          ownerLabel={(entry) => personName(entry.user)}
          openEditEntry={setEditing}
          setPersonDayModal={({ entries: dayEntries, date: day }) => onOpenPerson(dayEntries[0].user.id, day)}
          openNewEntry={onAddEntry}
          addDisabled={addDisabled}
        />
      )}
      <EditTimeEntryModal
        phoneSheet
        isOpen={!!editing}
        entry={editing}
        categories={editing ? categories.filter(category => editing.user.time_category_ids?.includes(category.id)) : []}
        canManageTeamTime
        canDelete
        onClose={() => setEditing(null)}
        onSaved={() => { setEditing(null); setRevision(value => value + 1); onChanged?.() }}
        onDeleted={() => { setEditing(null); setRevision(value => value + 1); onChanged?.() }}
      />
    </section>
  )
}
