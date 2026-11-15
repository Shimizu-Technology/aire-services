import { useState, type FormEvent } from 'react'
import { outcomeUnknown, timecardsApi } from '../../lib/api/timecards'
import { formatHours, manualShiftHours } from '../../lib/timecards'
import { useOnlineStatus } from '../../lib/useOnlineStatus'
import { Button, Field, Input, PersonPicker, Select, Sheet, Textarea } from '../ui'

export interface MissedTimePerson {
  id: number
  name: string
  firstName: string
  meta?: string
  timeCategoryIds: number[]
}

export interface MissedTimePrefill {
  /** The person whose timecard this came from. Never the viewer by default. */
  personId?: number | null
  workDate?: string
  startTime?: string
  endTime?: string
  note?: string
}

export interface LogMissedTimeSheetProps {
  open: boolean
  onClose: () => void
  people: MissedTimePerson[]
  categories: Array<{ id: number; name: string }>
  prefill: MissedTimePrefill
  /** Guam today, the default day. */
  today: string
  /** After the shift is saved, with the hours it adds. */
  onSaved: (person: MissedTimePerson, hours: number) => void
  /** When a save's outcome is unknown, so the page can reload that person's time. */
  onUncertain?: (person: MissedTimePerson) => void
  /** Why it can't be saved right now, e.g. the work categories didn't load. */
  blockedReason?: string | null
}

const BREAKS = [
  { label: 'None', minutes: 0 },
  { label: '15 min', minutes: 15 },
  { label: '30 min', minutes: 30 },
  { label: '45 min', minutes: 45 },
  { label: '1 hour', minutes: 60 },
]

/**
 * Adds a shift someone forgot to clock. "Who worked" comes from the timecard
 * you were on and is always required; it never falls back to you. The new
 * shift waits in Approvals as an added shift.
 */
export function LogMissedTimeSheet(props: LogMissedTimeSheetProps) {
  if (!props.open) return null
  // Mounted per opening, so every opening starts from its own prefill.
  return <LogMissedTimeForm {...props} />
}

function LogMissedTimeForm({ onClose, people, categories, prefill, today, onSaved, onUncertain, blockedReason = null }: LogMissedTimeSheetProps) {
  const online = useOnlineStatus()
  const [personId, setPersonId] = useState<number | null>(prefill.personId && people.some(person => person.id === prefill.personId) ? prefill.personId : null)
  const person = people.find(row => row.id === personId) ?? null
  const assigned = categories.filter(category => person?.timeCategoryIds.includes(category.id))
  const [workDate, setWorkDate] = useState(prefill.workDate ?? today)
  const [startTime, setStartTime] = useState(prefill.startTime ?? '07:00')
  const [endTime, setEndTime] = useState(prefill.endTime ?? '15:30')
  const [breakMinutes, setBreakMinutes] = useState(30)
  const [categoryChoice, setCategoryChoice] = useState('')
  const [note, setNote] = useState(prefill.note ?? '')
  const [errors, setErrors] = useState<{ person?: string; workDate?: string; time?: string; category?: string }>({})
  const [failure, setFailure] = useState<{ message: string; saved: 'no' | 'unknown' } | null>(null)
  const [saving, setSaving] = useState(false)

  // One assigned category needs no choice; a choice that isn't assigned to this person doesn't count.
  const categoryId = assigned.some(category => String(category.id) === categoryChoice) ? categoryChoice : assigned.length === 1 ? String(assigned[0].id) : ''
  const hours = manualShiftHours(startTime, endTime, breakMinutes)
  const prefilled = prefill.personId != null && personId === prefill.personId

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const next: typeof errors = {}
    if (!person) next.person = 'Choose who worked.'
    if (!workDate) next.workDate = 'Choose the day.'
    else if (workDate > today) next.workDate = "That day hasn't happened yet."
    if (hours <= 0) next.time = 'Check the start, end and break: this shift has no hours.'
    if (person && !categoryId && !blockedReason) next.category = assigned.length === 0 ? `${person.firstName} has no work categories. Assign one in Team first.` : 'Choose the work.'
    setErrors(next)
    setFailure(null)
    if (Object.keys(next).length > 0 || !person || blockedReason) return
    setSaving(true)
    const response = await timecardsApi.logMissedTime({
      userId: person.id, workDate, startTime, endTime, breakMinutes: breakMinutes || null, timeCategoryId: Number(categoryId), note,
    })
    setSaving(false)
    if (response.error) {
      // A lost answer may still have saved the shift: say so, keep what was
      // typed, and reload their time rather than inviting a duplicate.
      if (outcomeUnknown(response)) {
        setFailure({ saved: 'unknown', message: "We couldn't confirm this was saved. Check the timecard before adding it again." })
        onUncertain?.(person)
      } else {
        setFailure({ saved: 'no', message: `${response.error} Nothing was saved.` })
      }
      return
    }
    onSaved(person, hours)
  }

  const formId = 'log-missed-time'
  return (
    <Sheet
      open
      onClose={() => { if (!saving) onClose() }}
      title="Log missed time"
      description="It goes to Approvals as an added shift and waits there until someone approves it."
      initialFocus={prefilled ? '#log-missed-time-day' : undefined}
      footer={(
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button type="submit" form={formId} loading={saving} disabled={!online || !person || !!blockedReason} title={!online ? 'Reconnect to save' : blockedReason ?? (!person ? 'Choose who worked first' : undefined)}>
            {person ? `Add ${formatHours(hours)} for ${person.firstName}` : 'Add shift'}
          </Button>
        </div>
      )}
    >
      <form id={formId} onSubmit={submit} noValidate className="space-y-4">
        {blockedReason && <p role="alert" className="rounded-control border border-amber-200 bg-amber-50 px-3 py-2 text-body-sm text-amber-900">{blockedReason}</p>}
        <div>
          <PersonPicker
            label="Who worked"
            people={people}
            value={personId}
            onChange={(chosen) => { setPersonId(Number(chosen.id)); setErrors(current => ({ ...current, person: undefined })) }}
            description={prefilled ? 'Picked from the timecard you were on.' : 'Required. Choose the person who worked the shift.'}
          />
          {errors.person && <p role="alert" className="mt-1.5 text-body-sm font-medium text-danger">{errors.person}</p>}
        </div>
        <Field id="log-missed-time-day" label="Day" required error={errors.workDate}>
          <Input type="date" max={today} value={workDate} onChange={(event) => setWorkDate(event.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Start" required error={errors.time}>
            <Input type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)} />
          </Field>
          <Field label="End" required help={endTime < startTime ? 'Ends the next day' : undefined}>
            <Input type="time" enterKeyHint="done" value={endTime} onChange={(event) => setEndTime(event.target.value)} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Break">
            <Select value={breakMinutes} onChange={(event) => setBreakMinutes(Number(event.target.value))}>
              {BREAKS.map(option => <option key={option.minutes} value={option.minutes}>{option.label}</option>)}
            </Select>
          </Field>
          <Field label="Work" required error={errors.category}>
            <Select value={categoryId} disabled={!person} onChange={(event) => setCategoryChoice(event.target.value)}>
              <option value="">{person ? 'Choose…' : 'Choose a person first'}</option>
              {assigned.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}
            </Select>
          </Field>
        </div>
        <Field label="Note">
          <Textarea rows={2} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Phone died, worked the ramp" />
        </Field>
        {failure && <p role="alert" className="rounded-control border border-red-200 bg-danger-soft px-3 py-2 text-body-sm text-red-900">{failure.message}</p>}
      </form>
    </Sheet>
  )
}
