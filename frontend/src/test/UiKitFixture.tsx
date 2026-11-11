import { useMemo, useState } from 'react'
import {
  Avatar,
  Button,
  EmptyState,
  ErrorState,
  ListGroup,
  ListRow,
  Menu,
  OfflineBanner,
  PageHeader,
  SegmentedControl,
  SelectionBar,
  StatusPill,
  TabChips,
  useToast,
} from '../components/ui'

// A Storybook-free page that puts the list, selection and feedback kit
// together the way the Approvals inbox will. Rendered by UiKitFixture.test.tsx.

export interface FixtureShift { id: number; date: string; times: string; hours: number }
export interface FixturePerson { id: number; name: string; shifts: FixtureShift[] }

const FIXTURE_PEOPLE: FixturePerson[] = [
  { id: 1, name: 'Marcus Quinata', shifts: [{ id: 11, date: 'Tue, Nov 10', times: '7:30a–4:21p', hours: 8.9 }, { id: 12, date: 'Wed, Nov 11', times: '7:28a–4:30p', hours: 9.0 }] },
  { id: 2, name: 'Grace Torres', shifts: [{ id: 21, date: 'Tue, Nov 10', times: '6:58a–3:40p', hours: 8.7 }] },
  { id: 3, name: 'Tåsi Leon Guerrero-Santos', shifts: [{ id: 31, date: 'Wed, Nov 11', times: '8:00a–5:15p', hours: 9.3 }, { id: 32, date: 'Tue, Nov 10', times: '8:02a–5:00p', hours: 9.0 }] },
]

const hours = (value: number) => `${value.toFixed(1)}h`

export function UiKitFixture({ people = FIXTURE_PEOPLE, onApprove }: { people?: FixturePerson[]; onApprove?: (ids: number[]) => void }) {
  const toast = useToast()
  const [kind, setKind] = useState<'time' | 'leave'>('time')
  const [group, setGroup] = useState<'person' | 'day'>('person')
  const [approved, setApproved] = useState<Set<number>>(new Set())
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [failed, setFailed] = useState(false)

  const waiting = useMemo(() => people
    .map(person => ({ ...person, shifts: person.shifts.filter(shift => !approved.has(shift.id)) }))
    .filter(person => person.shifts.length > 0), [people, approved])
  const selectedShifts = waiting.flatMap(person => person.shifts.filter(shift => selected.has(shift.id)).map(shift => ({ person, shift })))
  const selectedPeople = new Set(selectedShifts.map(({ person }) => person.id)).size

  const approve = (ids: number[], who: string) => {
    onApprove?.(ids)
    setApproved(set => new Set([...set, ...ids]))
    setSelected(set => new Set([...set].filter(id => !ids.includes(id))))
    toast.show({
      message: `Approved ${ids.length} ${ids.length === 1 ? 'shift' : 'shifts'} for ${who}`,
      action: { label: 'Undo', onAction: () => {
        setApproved(set => new Set([...set].filter(id => !ids.includes(id))))
        toast.show({ message: `Moved ${ids.length} ${ids.length === 1 ? 'shift' : 'shifts'} back to waiting.` })
      } },
    })
  }

  const setMany = (ids: number[], on: boolean) => setSelected(set => {
    const next = new Set(set)
    ids.forEach(id => (on ? next.add(id) : next.delete(id)))
    return next
  })

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader
        title="Approvals"
        description="UI kit fixture · 5 waiting"
        actions={<Menu label="More actions" items={[
          { id: 'fail', label: failed ? 'Load the list again' : 'Show a load failure', onSelect: () => setFailed(value => !value) },
          { id: 'reset', label: 'Reset approvals', onSelect: () => setApproved(new Set()) },
        ]} />}
      />
      <TabChips label="What's waiting" value={kind} onChange={setKind} items={[{ value: 'time', label: 'Time', count: waiting.reduce((sum, person) => sum + person.shifts.length, 0) }, { value: 'leave', label: 'Leave', count: 0 }]} />
      <OfflineBanner loadedAt={new Date()} />

      {kind === 'leave' && <EmptyState title="No leave requests waiting." />}

      {kind === 'time' && failed && <ErrorState title="Couldn't load approvals." onRetry={() => setFailed(false)} />}

      {kind === 'time' && !failed && (
        <>
          <section aria-labelledby="needs-look" className="space-y-2">
            <h2 id="needs-look" className="text-body font-semibold text-ink">Needs a look · 1</h2>
            <ListGroup label="Needs a look">
              <ListRow
                leading={<Avatar name="Ethan Cruz" />}
                title="Ethan Cruz"
                meta="Fri, Nov 6 · 6.0h overtime this week"
                trailing={<StatusPill tone="waiting">Overtime</StatusPill>}
                action={{ label: 'Review', onClick: () => toast.show({ message: 'The Review sheet arrives with the Approvals page.' }) }}
              />
            </ListGroup>
          </section>

          <section aria-labelledby="ordinary" className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="ordinary" className="text-body font-semibold text-ink">Ordinary shifts · {waiting.reduce((sum, person) => sum + person.shifts.length, 0)}</h2>
              <SegmentedControl label="Group shifts" value={group} onChange={setGroup} options={[{ value: 'person', label: 'By person' }, { value: 'day', label: 'By day' }]} />
            </div>
            {waiting.length === 0 ? (
              <EmptyState title="All caught up." description="Nothing is waiting for approval." />
            ) : (
              <ListGroup label="Ordinary shifts by person">
                {waiting.map(person => {
                  const ids = person.shifts.map(shift => shift.id)
                  const count = ids.filter(id => selected.has(id)).length
                  const total = person.shifts.reduce((sum, shift) => sum + shift.hours, 0)
                  return (
                    <ListRow
                      key={person.id}
                      leading={<Avatar name={person.name} />}
                      title={person.name}
                      meta={`${ids.length} ${ids.length === 1 ? 'shift' : 'shifts'} · ${hours(total)}`}
                      checkbox={{ checked: count === 0 ? false : count === ids.length ? true : 'mixed', onChange: on => setMany(ids, on), label: `Select ${person.name}'s shifts` }}
                      action={{ label: `Approve ${ids.length}`, ariaLabel: `Approve ${ids.length} ${ids.length === 1 ? 'shift' : 'shifts'} for ${person.name}`, onClick: () => approve(ids, person.name) }}
                      expanded={expanded.has(person.id)}
                      onExpandedChange={on => setExpanded(set => { const next = new Set(set); if (on) next.add(person.id); else next.delete(person.id); return next })}
                      expandLabel={`Show ${person.name}'s shifts`}
                    >
                      {person.shifts.map(shift => (
                        <ListRow
                          key={shift.id}
                          title={`${shift.date} · ${shift.times}`}
                          trailing={<span className="font-semibold tabular-nums">{hours(shift.hours)}</span>}
                          checkbox={{ checked: selected.has(shift.id), onChange: on => setMany([shift.id], on), label: `Select ${person.name}, ${shift.date}` }}
                        />
                      ))}
                    </ListRow>
                  )
                })}
              </ListGroup>
            )}
          </section>
        </>
      )}

      <SelectionBar
        count={selectedShifts.length}
        noun={['shift', 'shifts']}
        summary={`${selectedPeople} ${selectedPeople === 1 ? 'person' : 'people'} · ${hours(selectedShifts.reduce((sum, { shift }) => sum + shift.hours, 0))}`}
        label="Selected shifts"
        onClear={() => setSelected(new Set())}
        actions={<Button onClick={() => approve(selectedShifts.map(({ shift }) => shift.id), selectedPeople === 1 ? selectedShifts[0].person.name : `${selectedPeople} people`)}>{`Approve ${selectedShifts.length}`}</Button>}
      />
    </div>
  )
}
