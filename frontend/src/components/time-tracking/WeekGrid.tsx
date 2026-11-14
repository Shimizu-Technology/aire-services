import { useEffect, useRef, useState } from 'react'
import { ArrowRight } from 'lucide-react'
import { businessDateISO, formatDateOnly } from '../../lib/dateUtils'

// The team week grid (Timecards' Everyone view). Moved out of TimeTracking.tsx
// unchanged; each page keeps its own data, modals and "+ Add" form.

/** The fields the grid reads; TimeTracking's entries and the API's both fit. */
export interface WeekGridEntry {
  id: number
  hours: number
  start_time: string | null
  formatted_start_time: string | null
  formatted_end_time: string | null
  approval_status?: 'pending' | 'approved' | 'denied' | null
  time_category: { name: string } | null
  user: { id: number }
}

export interface WeekGridProps<T extends WeekGridEntry> {
  /** Sunday to Saturday, YYYY-MM-DD. */
  weekDates: string[]
  entriesByDate: Record<string, T[]>
  hoursPerDay: Record<string, number>
  ownerLabel: (entry: T) => string
  openEditEntry: (entry: T) => void
  /** One person's several entries on one day. */
  setPersonDayModal: (day: { entries: T[]; name: string; date: string }) => void
  openNewEntry: (date: string) => void
  addDisabled: boolean
}

const ClockIcon = () => (
  <svg className="h-5 w-5" fill="none" aria-hidden="true" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
)

function sumEntryHours(entries: WeekGridEntry[]): number {
  return entries.reduce((sum, entry) => sum + entry.hours, 0)
}

function sortEntriesChronologically(a: WeekGridEntry, b: WeekGridEntry): number {
  const aStart = a.start_time || ''
  const bStart = b.start_time || ''

  if (aStart && bStart && aStart !== bStart) return aStart.localeCompare(bStart)
  if (aStart !== bStart) return aStart ? -1 : 1
  return a.id - b.id
}

export default function WeekGrid<T extends WeekGridEntry>({
  weekDates,
  entriesByDate,
  hoursPerDay,
  ownerLabel,
  openEditEntry,
  setPersonDayModal,
  openNewEntry,
  addDisabled,
}: WeekGridProps<T>) {
  // Below 1280px seven days don't fit readably beside the sidebar, so the week is a
  // wider canvas that scrolls sideways, with a cue while more days are off to the right.
  const scroller = useRef<HTMLDivElement>(null)
  const [moreRight, setMoreRight] = useState(false)
  useEffect(() => {
    const node = scroller.current
    if (!node) return
    const update = () => setMoreRight(node.scrollWidth - node.clientWidth - node.scrollLeft > 4)
    update()
    node.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    return () => {
      node.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [])
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-neutral-warm overflow-hidden hover:shadow-md transition-shadow duration-300">
      <p className="flex items-center gap-1.5 border-b border-neutral-warm bg-surface-muted px-3 py-2 text-sm text-ink-muted xl:hidden">
        Scroll sideways to see every day
        <ArrowRight className="size-4" aria-hidden="true" />
      </p>
      <div className="relative">
      <div ref={scroller} className="overflow-x-auto">
        {/* Week Header */}
        <div className="grid min-w-[1020px] grid-cols-7 border-b border-neutral-warm xl:min-w-full">
          {weekDates.map((date, idx) => {
            const dateStr = date
            const isToday = date === businessDateISO()
            const dayHours = hoursPerDay[dateStr] || 0
            
            return (
              <div
                key={idx}
                className={`p-2 sm:p-3 text-center border-r border-neutral-warm last:border-r-0 ${
                  isToday ? 'bg-primary/20 border-b-2 border-b-primary' : ''
                }`}
              >
                <div className={`text-xs font-semibold uppercase ${isToday ? 'text-primary' : 'text-primary-dark'}`}>
                  {formatDateOnly(date, { weekday: 'short' })}
                </div>
                <div className={`text-base sm:text-lg font-bold ${isToday ? 'text-primary' : 'text-primary-dark'}`}>
                  {Number(date.slice(8, 10))}
                </div>
                <div className={`text-xs font-semibold ${isToday ? 'text-primary' : (dayHours > 0 ? 'text-primary' : 'text-primary-dark')}`}>
                  {dayHours.toFixed(1)}h
                </div>
              </div>
            )
          })}
        </div>

        {/* Week Entries */}
        <div className="grid min-h-[280px] grid-cols-7 min-w-[1020px] sm:min-h-[320px] xl:min-w-full">
          {weekDates.map((date, idx) => {
            const dateStr = date
            const dayEntries = entriesByDate[dateStr] || []
            const isToday = date === businessDateISO()

            const groupedByUser = dayEntries.reduce((acc, entry) => {
              const uid = entry.user.id
              if (!acc[uid]) acc[uid] = []
              acc[uid].push(entry)
              return acc
            }, {} as Record<number, T[]>)

            const userGroups = Object.values(groupedByUser).map(group => [...group].sort(sortEntriesChronologically))
            
            return (
              <div
                key={idx}
                className={`border-r border-neutral-warm last:border-r-0 p-1 sm:p-2 ${
                  isToday ? 'bg-primary/10' : ''
                }`}
              >
                {userGroups.map(userEntries => {
                  const totalHours = sumEntryHours(userEntries)
                  const name = ownerLabel(userEntries[0])
                  const hasMultiple = userEntries.length > 1
                  const hasPending = userEntries.some(e => e.approval_status === 'pending')
                  const hasDenied = userEntries.some(e => e.approval_status === 'denied')
                  const firstStart = userEntries[0].formatted_start_time
                  const lastEnd = userEntries[userEntries.length - 1].formatted_end_time

                  if (!hasMultiple) {
                    const entry = userEntries[0]
                    return (
                      <button
                        type="button"
                        key={entry.id}
                        className="mb-2 w-full cursor-pointer rounded-xl border border-neutral-warm bg-white p-2.5 text-left text-xs shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                        onClick={() => openEditEntry(entry)}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2 py-1 text-[11px] font-semibold text-primary-dark">
                            <ClockIcon />
                            {entry.hours.toFixed(2)}h
                          </div>
                          <div className="flex items-center gap-1">
                            {entry.approval_status === 'pending' && <span className="h-2 w-2 rounded-full bg-amber-500" title="Pending approval" />}
                            {entry.approval_status === 'denied' && <span className="h-2 w-2 rounded-full bg-red-500" title="Denied" />}
                          </div>
                        </div>
                        {entry.formatted_start_time && entry.formatted_end_time && (
                          <div className="mt-2 text-[11px] font-medium text-primary-dark/75">{entry.formatted_start_time} – {entry.formatted_end_time}</div>
                        )}
                        {entry.time_category && (
                          <div className="mt-1 truncate text-[11px] font-medium text-primary">{entry.time_category.name}</div>
                        )}
                        <div className="mt-1 truncate text-[11px] text-primary-dark/70">{name}</div>
                      </button>
                    )
                  }

                  return (
                    <CalendarUserGroup
                      key={userEntries[0].user.id}
                      entries={userEntries}
                      name={name}
                      totalHours={totalHours}
                      firstStart={firstStart}
                      lastEnd={lastEnd}
                      hasPending={hasPending}
                      hasDenied={hasDenied}
                      onClick={() => setPersonDayModal({ entries: userEntries, name, date })}
                    />
                  )
                })}
                <button
                  onClick={() => openNewEntry(date)}
                  disabled={addDisabled}
                className="w-full rounded p-1.5 text-xs font-medium text-primary-dark transition-colors hover:bg-neutral-warm hover:text-primary sm:p-2"
              >
                + Add
                </button>
              </div>
            )
          })}
        </div>
      </div>
      {moreRight && (
        <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-linear-to-l from-white to-transparent xl:hidden" />
      )}
      </div>
    </div>
  )
}

function CalendarUserGroup({
  entries,
  name,
  totalHours,
  firstStart,
  lastEnd,
  hasPending,
  hasDenied,
  onClick,
}: {
  entries: WeekGridEntry[]
  name: string
  totalHours: number
  firstStart: string | null
  lastEnd: string | null
  hasPending: boolean
  hasDenied: boolean
  onClick: () => void
}) {
  const catSummary = entries.reduce((acc, e) => {
    const cat = e.time_category?.name || 'Other'
    acc[cat] = (acc[cat] || 0) + e.hours
    return acc
  }, {} as Record<string, number>)
  const categoryRows = Object.entries(catSummary)
  const visibleCategories = categoryRows.slice(0, 2)
  const hiddenCategoryCount = Math.max(0, categoryRows.length - visibleCategories.length)

  return (
    <div
      className="mb-2 cursor-pointer rounded-xl border border-neutral-warm bg-white text-xs shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md"
      onClick={onClick}
    >
      <div className="p-2.5 sm:p-3">
        <div className="flex items-center gap-2">
          <div className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-primary/10 px-2 py-1 text-[11px] font-semibold text-primary-dark">
            <ClockIcon />
            {totalHours.toFixed(2)}h
          </div>
          <div className="flex items-center gap-1.5">
            {hasPending && <span className="h-2 w-2 rounded-full bg-amber-500" title="Has pending entries" />}
            {hasDenied && <span className="h-2 w-2 rounded-full bg-red-500" title="Has denied entries" />}
          </div>
        </div>
        {firstStart && lastEnd && (
          <div className="mt-2 text-[11px] font-medium text-primary-dark/75">{firstStart} – {lastEnd}</div>
        )}
        <div className="mt-1 text-[10px] font-medium uppercase tracking-[0.08em] text-primary/60">
          {entries.length} {entries.length === 1 ? 'entry' : 'entries'}
        </div>
        <div className="mt-2 space-y-1.5">
          {visibleCategories.map(([cat, hrs]) => (
            <div key={cat} className="flex min-w-0 items-center justify-between gap-2 text-[11px]">
              <span className="truncate font-medium text-primary">{cat}</span>
              <span className="shrink-0 text-text-muted">{hrs.toFixed(2)}h</span>
            </div>
          ))}
          {hiddenCategoryCount > 0 && (
            <div className="text-[10px] font-medium text-text-muted">+{hiddenCategoryCount} more categories</div>
          )}
        </div>
        <div className="mt-2 truncate text-[11px] text-primary-dark/70">{name}</div>
      </div>
    </div>
  )
}
