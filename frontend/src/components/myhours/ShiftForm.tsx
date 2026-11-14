import { useState, type FormEvent } from 'react'
import type { TimeEntry } from '../../lib/api'
import { myTimeApi } from '../../lib/api/myTime'
import { outcomeUnknown } from '../../lib/api/timecards'
import { guamClock } from '../../lib/timecards'
import { todayInGuam } from '../../lib/payPeriods'
import { useOnlineStatus } from '../../lib/useOnlineStatus'
import { Button, Field, Input, Select, Sheet, Textarea } from '../ui'

function minutesBetween(start: string, end: string) {
  const minutes = (time: string) =>
    Number(time.slice(0, 2)) * 60 + Number(time.slice(3))
  return (minutes(end) - minutes(start) + 1440) % 1440
}

function editableBreaks(entry?: TimeEntry) {
  return (entry?.breaks ?? [])
    .filter((row) => row.end_time)
    .map((row) => ({
      id: row.id,
      start_time: guamClock(row.start_time),
      end_time: guamClock(row.end_time!),
    }))
}

export function ShiftForm({
  entry: initialEntry,
  categories,
  categoriesError,
  categoriesLoading = false,
  onRetryCategories,
  onClose,
  onSaved,
}: {
  entry?: TimeEntry
  categories: Array<{ id: number; name: string }>
  categoriesError?: string | null
  categoriesLoading?: boolean
  onRetryCategories?: () => void
  onClose: () => void
  onSaved: () => void
}) {
  const online = useOnlineStatus()
  const [entry, setEntry] = useState(initialEntry)
  const [date, setDate] = useState(entry?.work_date ?? todayInGuam())
  const [start, setStart] = useState(entry?.start_time ?? '08:00')
  const [end, setEnd] = useState(entry?.end_time ?? '17:00')
  const [breakMinutes, setBreakMinutes] = useState(entry?.break_minutes ?? 0)
  const [breaks, setBreaks] = useState(() => editableBreaks(entry))
  const detailedBreaks = !!entry?.breaks.length
  const breaksChanged =
    detailedBreaks &&
    (breaks.length !== entry.breaks.length ||
      breaks.some((row) => {
        const original = entry.breaks.find((item) => item.id === row.id)
        return (
          !original ||
          guamClock(original.start_time) !== row.start_time ||
          !original.end_time ||
          guamClock(original.end_time) !== row.end_time
        )
      }))
  const totalBreakMinutes = breaksChanged
    ? breaks.reduce(
        (sum, row) => sum + minutesBetween(row.start_time, row.end_time),
        0,
      )
    : breakMinutes
  const [category, setCategory] = useState(
    entry?.time_category?.id ?? categories[0]?.id ?? 0,
  )
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [uncertain, setUncertain] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const unchangedTime =
    entry &&
    start === entry.start_time &&
    end === entry.end_time &&
    totalBreakMinutes === (entry.break_minutes ?? 0)
  const hours = unchangedTime
    ? entry.hours
    : Math.max(0, (minutesBetween(start, end) - totalBreakMinutes) / 60)
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!online || saving || uncertain) return
    if (
      !category ||
      !date ||
      date > todayInGuam() ||
      hours <= 0 ||
      (entry && !note.trim())
    ) {
      setError('Check the day, times and work. For a fix, say what happened.')
      return
    }
    if (
      entry &&
      unchangedTime &&
      !breaksChanged &&
      category === entry.time_category?.id
    ) {
      setError('Change a time, break or work type before sending a fix.')
      return
    }
    setSaving(true)
    setError(null)
    if (entry) {
      const latest = await myTimeApi.entry(entry.id)
      if (!latest.data) {
        setSaving(false)
        setError("Couldn't check this shift. Nothing was sent. Try again.")
        return
      }
      const fresh = latest.data.time_entry
      if (fresh.version !== entry.version) {
        setEntry(fresh)
        setDate(fresh.work_date)
        setStart(fresh.start_time ?? '08:00')
        setEnd(fresh.end_time ?? '17:00')
        setBreakMinutes(fresh.break_minutes ?? 0)
        setBreaks(editableBreaks(fresh))
        setCategory(fresh.time_category?.id ?? 0)
        setNote('')
        setSaving(false)
        setError(
          "This shift changed since you opened it. Nothing was sent. Here's the latest.",
        )
        return
      }
    }
    const change = {
      start_time: start,
      end_time: end,
      break_minutes: totalBreakMinutes || null,
      ...(detailedBreaks
        ? {
            breaks: breaks.map((row) => {
              const original = entry?.breaks.find((item) => item.id === row.id)
              return {
                ...row,
                start_time:
                  original && guamClock(original.start_time) === row.start_time
                    ? original.start_time
                    : row.start_time,
                end_time:
                  original?.end_time &&
                  guamClock(original.end_time) === row.end_time
                    ? original.end_time
                    : row.end_time,
              }
            }),
          }
        : {}),
      time_category_id: category,
      description: entry?.description ?? (note.trim() || undefined),
    }
    const response = entry
      ? await myTimeApi.askForFix(
          entry,
          { ...change, description: entry.description ?? '' },
          note.trim(),
        )
      : await myTimeApi.addTime({ ...change, work_date: date })
    setSaving(false)
    if (!response.data) {
      const unknown = outcomeUnknown(response)
      setUncertain(unknown)
      setError(
        unknown
          ? "We couldn't confirm this was saved. Close this sheet and check My Hours before trying again."
          : response.error || 'Nothing was saved. Try again.',
      )
      return
    }
    onSaved()
  }

  return (
    <Sheet
      open
      onClose={() => {
        if (!saving) onClose()
      }}
      title={entry ? 'Ask for a fix' : 'Add time I forgot to clock'}
      description="Your manager approves the change."
      footer={
        <Button
          fullWidth
          form="my-shift-form"
          type="submit"
          loading={saving}
          disabled={!online || uncertain || !categories.length}
        >
          {entry
            ? 'Send fix for approval'
            : `Add ${hours.toFixed(1)}h for approval`}
        </Button>
      }
    >
      <form id="my-shift-form" onSubmit={submit} className="space-y-4">
        <Field label="Day" required>
          <Input
            type="date"
            max={todayInGuam()}
            value={date}
            disabled={!!entry}
            onChange={(event) => setDate(event.target.value)}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Clock in" required>
            <Input
              type="time"
              value={start}
              onChange={(event) => setStart(event.target.value)}
            />
          </Field>
          <Field
            label="Clock out"
            required
            help={end < start ? 'Ends the next day' : undefined}
          >
            <Input
              type="time"
              enterKeyHint="done"
              value={end}
              onChange={(event) => setEnd(event.target.value)}
            />
          </Field>
        </div>
        {detailedBreaks ? (
          <fieldset className="space-y-3">
            <legend className="text-body-sm font-medium">Breaks</legend>
            {breaks.map((row, index) => (
              <div
                key={row.id}
                className="space-y-2 rounded-control border border-line p-3"
              >
                <div className="grid grid-cols-2 gap-3">
                  <Field label={`Break ${index + 1} start`}>
                    <Input
                      type="time"
                      required
                      value={row.start_time}
                      onChange={(event) =>
                        setBreaks((items) =>
                          items.map((item, n) =>
                            n === index
                              ? { ...item, start_time: event.target.value }
                              : item,
                          ),
                        )
                      }
                    />
                  </Field>
                  <Field label={`Break ${index + 1} end`}>
                    <Input
                      type="time"
                      required
                      value={row.end_time}
                      onChange={(event) =>
                        setBreaks((items) =>
                          items.map((item, n) =>
                            n === index
                              ? { ...item, end_time: event.target.value }
                              : item,
                          ),
                        )
                      }
                    />
                  </Field>
                </div>
                <Button
                  variant="ghost"
                  onClick={() =>
                    setBreaks((items) => items.filter((_, n) => n !== index))
                  }
                >
                  Remove break {index + 1}
                </Button>
              </div>
            ))}
          </fieldset>
        ) : (
          <Field label="Break minutes">
            <Input
              type="number"
              min="0"
              max="1440"
              inputMode="numeric"
              value={breakMinutes}
              onChange={(event) => setBreakMinutes(Number(event.target.value))}
            />
          </Field>
        )}
        <Field label="Work" required>
          <Select
            value={category}
            onChange={(event) => setCategory(Number(event.target.value))}
          >
            <option value="0">Choose work</option>
            {categories.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={entry ? 'What happened?' : 'Note'} required={!!entry}>
          <Textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </Field>
        {categoriesLoading ? (
          <p role="status">Loading your work types…</p>
        ) : categoriesError ? (
          <div role="alert" className="space-y-2">
            <p>Couldn't load your work types.</p>
            <Button variant="secondary" onClick={onRetryCategories}>
              Try again
            </Button>
          </div>
        ) : !categories.length ? (
          <p>Ask Chels to set up your work types.</p>
        ) : null}
        {!online && <p role="status">No connection. Reconnect to save.</p>}
        {error && (
          <p role="alert" className="text-body-sm text-danger">
            {error}
          </p>
        )}
      </form>
    </Sheet>
  )
}
