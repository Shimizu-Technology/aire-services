import { useId, useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { formatHours, type TimecardPersonRow } from '../../lib/timecards'
import { Avatar, EmptyState, ErrorState, FilterChip, ListGroup, ListRow, StatusPill, type StatusTone } from '../ui'
import { Skeleton } from '../ui/Skeleton'

/** "needs" (Needs a look), "all", or a department label. */
export type PeopleFilter = string

export interface PeoplePickerProps {
  people: TimecardPersonRow[] | null
  selectedId: number | null
  onSelect: (person: TimecardPersonRow) => void
  /** From the URL; null means the default (Needs a look when anyone does). */
  filter: PeopleFilter | null
  onFilterChange: (filter: PeopleFilter) => void
  error?: string | null
  onRetry?: () => void
}

// "tasi" finds "Tåsi"; case, accents and apostrophes don't matter.
const fold = (value: string) => value.normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/['’ʼ‘]/g, '').toLowerCase()

function pillFor(person: TimecardPersonRow): { tone: StatusTone; label: string } | null {
  if (person.employmentStatus === 'terminated') return { tone: 'off', label: 'Employment ended' }
  if (person.openClock === 'stale') return { tone: 'needs-fix', label: 'Still clocked in' }
  if (person.overtimeWaitingCount > 0) return { tone: 'waiting', label: 'OT waiting' }
  if (person.waitingCount > 0) return { tone: 'waiting', label: `${person.waitingCount} waiting` }
  if (person.openClock === 'live') return { tone: 'info', label: 'On the clock' }
  return null
}

/** Finds one person: search, "Needs a look" first, then departments. */
export function PeoplePicker({ people, selectedId, onSelect, filter, onFilterChange, error, onRetry }: PeoplePickerProps) {
  const ids = useId()
  const [query, setQuery] = useState('')
  const needsLook = useMemo(() => people?.filter(person => person.needsLook) ?? [], [people])
  const groups = useMemo(() => [...new Set(people?.flatMap(person => person.groups) ?? [])].sort(), [people])
  const active = filter ?? (needsLook.length > 0 ? 'needs' : 'all')

  const shown = useMemo(() => {
    if (!people) return []
    const needle = fold(query.trim())
    // A search looks through everyone, whatever chip is on.
    if (needle) return people.filter(person => needle.split(/\s+/).every(word => fold(`${person.name} ${person.groups.join(' ')}`).includes(word)))
    if (active === 'needs') return needsLook
    if (active === 'all') return people
    return people.filter(person => person.groups.includes(active))
  }, [active, needsLook, people, query])

  const toggle = (value: PeopleFilter) => onFilterChange(active === value ? 'all' : value)

  return (
    <div className="space-y-3">
      <div className="relative">
        <label htmlFor={`${ids}-search`} className="sr-only">Find a person</label>
        <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-subtle" />
        <input
          id={`${ids}-search`}
          type="search"
          enterKeyHint="search"
          autoComplete="off"
          spellCheck={false}
          placeholder="Find a person"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="block min-h-11 w-full rounded-control border border-line-strong bg-surface pl-9 pr-3 text-body text-ink placeholder:text-ink-subtle focus:border-primary pointer-fine:text-body-sm"
        />
      </div>
      <div role="group" aria-label="Show" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        <FilterChip selected={active === 'needs'} onClick={() => toggle('needs')} count={people ? needsLook.length : undefined}>Needs a look</FilterChip>
        {groups.map(group => <FilterChip key={group} selected={active === group} onClick={() => toggle(group)}>{group}</FilterChip>)}
      </div>

      {error ? (
        <ErrorState title="Couldn't load people." description={error} onRetry={onRetry} />
      ) : !people ? (
        <div aria-busy="true" aria-label="Loading people" className="space-y-2 rounded-card border border-line bg-surface p-3">
          {Array.from({ length: 6 }, (_, index) => <Skeleton key={index} height={44} className="w-full" />)}
        </div>
      ) : shown.length === 0 ? (
        <EmptyState
          title={query ? `Nobody matches “${query}”.` : active === 'needs' ? 'Nobody needs a look.' : 'Nobody here.'}
          description={!query && active === 'needs' ? 'No forgotten clocks and nothing waiting for approval this pay period.' : undefined}
        />
      ) : (
        <ListGroup label="People" className="overflow-hidden rounded-card border border-line bg-surface">
          {shown.map((person) => {
            const pill = pillFor(person)
            const hours = person.approvedHours === null ? null : `${formatHours(person.approvedHours)} approved`
            return (
              <ListRow
                key={person.id}
                leading={<Avatar name={person.name} />}
                title={person.name}
                meta={[hours, person.groups.join(', ')].filter(Boolean).join(' · ') || undefined}
                trailing={pill ? <StatusPill tone={pill.tone}>{pill.label}</StatusPill> : undefined}
                selected={person.id === selectedId}
                onOpen={() => onSelect(person)}
              />
            )
          })}
        </ListGroup>
      )}
    </div>
  )
}
