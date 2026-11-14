import { useState, type FormEvent } from 'react'
import type { TimeEntry } from '../../lib/api'
import { myTimeApi } from '../../lib/api/myTime'
import { outcomeUnknown } from '../../lib/api/timecards'
import { manualShiftHours } from '../../lib/timecards'
import { todayInGuam } from '../../lib/payPeriods'
import { useOnlineStatus } from '../../lib/useOnlineStatus'
import { Button, Field, Input, Select, Sheet, Textarea } from '../ui'

export function ShiftForm({ entry, categories, onClose, onSaved }: {
  entry?: TimeEntry
  categories: Array<{ id: number; name: string }>
  onClose: () => void
  onSaved: () => void
}) {
  const online = useOnlineStatus()
  const [date, setDate] = useState(entry?.work_date ?? todayInGuam())
  const [start, setStart] = useState(entry?.start_time ?? '08:00')
  const [end, setEnd] = useState(entry?.end_time ?? '17:00')
  const [breakMinutes, setBreakMinutes] = useState(entry?.break_minutes ?? 0)
  const [category, setCategory] = useState(entry?.time_category?.id ?? categories[0]?.id ?? 0)
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [uncertain, setUncertain] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const hours = manualShiftHours(start, end, breakMinutes)
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!online || saving || uncertain) return
    if (!category || !date || date > todayInGuam() || hours <= 0 || (entry && !note.trim())) {
      setError('Check the day, times and work. For a fix, say what happened.')
      return
    }
    setSaving(true)
    setError(null)
    const change = {
      start_time: start, end_time: end,
      break_minutes: breakMinutes || null,
      time_category_id: category,
      description: entry?.description ?? (note.trim() || undefined),
    }
    const response = entry
      ? await myTimeApi.askForFix(entry, { ...change, description: entry.description ?? '' }, note.trim())
      : await myTimeApi.addTime({ ...change, work_date: date })
    setSaving(false)
    if (!response.data) {
      const unknown = outcomeUnknown(response)
      setUncertain(unknown)
      setError(unknown
        ? "We couldn't confirm this was saved. Close this sheet and check My Hours before trying again."
        : response.error || 'Nothing was saved. Try again.')
      return
    }
    onSaved()
  }

  return (
    <Sheet
      open
      onClose={() => { if (!saving) onClose() }}
      title={entry ? 'Ask for a fix' : 'Add time I forgot to clock'}
      description="Your manager approves the change."
      footer={(
        <Button
          fullWidth
          form="my-shift-form"
          type="submit"
          loading={saving}
          disabled={!online || uncertain || !categories.length}
        >
          {entry ? 'Send fix for approval' : `Add ${hours.toFixed(1)}h for approval`}
        </Button>
      )}
    >
      <form id="my-shift-form" onSubmit={submit} className="space-y-4">
        <Field label="Day" required>
          <Input type="date" max={todayInGuam()} value={date} disabled={!!entry} onChange={event => setDate(event.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Clock in" required>
            <Input type="time" value={start} onChange={event => setStart(event.target.value)} />
          </Field>
          <Field label="Clock out" required help={end < start ? 'Ends the next day' : undefined}>
            <Input type="time" enterKeyHint="done" value={end} onChange={event => setEnd(event.target.value)} />
          </Field>
        </div>
        <Field label="Break minutes">
          <Input type="number" min="0" max="1440" inputMode="numeric" value={breakMinutes} onChange={event => setBreakMinutes(Number(event.target.value))} />
        </Field>
        <Field label="Work" required>
          <Select value={category} onChange={event => setCategory(Number(event.target.value))}>
            <option value="0">Choose work</option>
            {categories.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}
          </Select>
        </Field>
        <Field label={entry ? 'What happened?' : 'Note'} required={!!entry}>
          <Textarea value={note} onChange={event => setNote(event.target.value)} />
        </Field>
        {!categories.length && <p>Ask Chels to set up your work types.</p>}
        {!online && <p role="status">No connection. Reconnect to save.</p>}
        {error && <p role="alert" className="text-body-sm text-danger">{error}</p>}
      </form>
    </Sheet>
  )
}
