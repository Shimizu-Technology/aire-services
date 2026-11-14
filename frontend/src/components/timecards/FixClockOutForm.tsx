import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import type { TimeEntry } from '../../lib/api'
import { outcomeUnknown, timecardsApi } from '../../lib/api/timecards'
import { formatDateOnly } from '../../lib/dateUtils'
import { formatHours, guamDate, previewClockOut } from '../../lib/timecards'
import { useOnlineStatus } from '../../lib/useOnlineStatus'
import { Button, Field, Input, Select, Textarea } from '../ui'

export interface FixClockOutFormProps {
  entry: TimeEntry
  /** Work categories, to choose one when the shift has none it can keep. */
  categories: Array<{ id: number; name: string }>
  onCancel: () => void
  onSaved: () => void
  /** After a conflict or an unknown outcome: close the form and load the shift's current version. */
  onReload: () => void
  /** Why it can't be saved right now, e.g. the work categories didn't load. */
  blockedReason?: string | null
}

const dayLabel = (date: string) => formatDateOnly(date, { weekday: 'short', month: 'short', day: 'numeric' })

/**
 * Ends a forgotten clock in place, on the timecard. The clock-out lands on the
 * day the API will save it (10:30 PM to 6:30 AM ends the next morning), and the
 * total shows before Save so a wrong day is visible.
 */
export function FixClockOutForm({ entry, categories, onCancel, onSaved, onReload, blockedReason = null }: FixClockOutFormProps) {
  const ids = useId()
  const online = useOnlineStatus()
  const timeRef = useRef<HTMLInputElement>(null)
  const assigned = categories.filter(category => entry.user.time_category_ids?.includes(category.id))
  const keepsCategory = entry.time_category && assigned.some(category => category.id === entry.time_category?.id)
  const [endTime, setEndTime] = useState('')
  const [categoryChoice, setCategoryChoice] = useState('')
  // Worked out from the current categories, which can arrive after the form opens.
  const categoryId = categoryChoice || (keepsCategory ? String(entry.time_category?.id) : assigned.length === 1 ? String(assigned[0].id) : '')
  const [reason, setReason] = useState('')
  const [errors, setErrors] = useState<{ endTime?: string; category?: string; reason?: string }>({})
  // `needsReload`: this version of the shift can't be saved again (it changed, or
  // a save may already have gone through), so Save waits for a fresh copy.
  const [failure, setFailure] = useState<{ message: string; needsReload: boolean } | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => { timeRef.current?.focus() }, [])

  const preview = previewClockOut(entry, endTime)
  const clockInDay = entry.clock_in_at ? guamDate(entry.clock_in_at) : entry.work_date
  const breakNote = preview ? (preview.breakMinutes > 0 ? `${preview.breakMinutes} min` : 'None') : entry.break_minutes ? `${entry.break_minutes} min` : 'None'

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const next: typeof errors = {}
    if (!preview) next.endTime = 'Enter the time they clocked out.'
    else if (preview.problem) next.endTime = preview.problem
    if (!categoryId) next.category = 'Choose the work this shift was.'
    if (!reason.trim()) next.reason = 'Say why the clock-out changed. It goes in the activity history.'
    setErrors(next)
    setFailure(null)
    if (Object.keys(next).length > 0 || !preview) return
    setSaving(true)
    const response = await timecardsApi.fixClockOut(entry, { stopDate: preview.stopDate, endTime, timeCategoryId: Number(categoryId), reason })
    setSaving(false)
    if (response.error) {
      if (outcomeUnknown(response)) {
        setFailure({ needsReload: true, message: "We couldn't confirm the clock-out was saved. Reload this shift to check before trying again." })
      } else if (response.status === 409) {
        setFailure({ needsReload: true, message: 'This shift changed since you opened it. Nothing was saved.' })
      } else {
        setFailure({ needsReload: false, message: `${response.error} Nothing was saved.` })
      }
      return
    }
    onSaved()
  }

  return (
    <form onSubmit={submit} aria-labelledby={`${ids}-title`} noValidate className="mt-3 space-y-4 rounded-card border border-amber-200 bg-surface p-4">
      <h3 id={`${ids}-title`} className="text-body font-semibold text-ink">Fix clock-out · {dayLabel(entry.work_date)}</h3>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="min-w-0">
          <p className="mb-1.5 text-body-sm font-medium text-ink">Clocked in</p>
          <p className="flex min-h-11 items-center text-body text-ink pointer-fine:text-body-sm">
            {clockInDay !== entry.work_date && `${dayLabel(clockInDay)}, `}{entry.formatted_start_time ?? 'Unknown'}
          </p>
        </div>
        <Field
          label="Clocked out"
          required
          error={errors.endTime}
          help={preview && preview.stopDate !== entry.work_date ? `Next day, ${dayLabel(preview.stopDate)}` : undefined}
        >
          <Input ref={timeRef} type="time" enterKeyHint="done" value={endTime} onChange={(event) => setEndTime(event.target.value)} />
        </Field>
        <div className="min-w-0">
          <p className="mb-1.5 text-body-sm font-medium text-ink">Break</p>
          <p className="flex min-h-11 items-center text-body text-ink pointer-fine:text-body-sm">{breakNote}</p>
        </div>
        {!keepsCategory && (
          <Field label="Work" required error={errors.category}>
            <Select value={categoryId} onChange={(event) => setCategoryChoice(event.target.value)}>
              <option value="">Choose…</option>
              {assigned.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}
            </Select>
          </Field>
        )}
      </div>
      <Field label="Why the change" required error={errors.reason}>
        <Textarea rows={2} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Forgot to clock out, confirmed with them" />
      </Field>
      <p aria-live="polite" className="text-body-sm text-ink-muted">
        {preview && !preview.problem ? <><span className="font-semibold text-ink">Total {formatHours(preview.hours)}.</span> </> : null}
        Goes back to Approvals as a corrected clock-out.
      </p>
      {blockedReason && <p role="alert" className="rounded-control border border-amber-200 bg-amber-50 px-3 py-2 text-body-sm text-amber-900">{blockedReason}</p>}
      {failure && (
        <div role="alert" className="rounded-control border border-red-200 bg-danger-soft px-3 py-2 text-body-sm text-red-900">
          {failure.message}
          {failure.needsReload && <Button variant="secondary" size="sm" onClick={onReload} className="mt-2 block">Reload this shift</Button>}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          type="submit"
          loading={saving}
          disabled={!online || !!blockedReason || !!failure?.needsReload}
          title={!online ? 'Reconnect to save' : blockedReason ?? (failure?.needsReload ? 'Reload this shift first' : undefined)}
        >
          Save clock-out
        </Button>
        {/* After a conflict, closing also reloads, so reopening never starts from the old version. */}
        <Button variant="secondary" onClick={failure?.needsReload ? onReload : onCancel} disabled={saving}>Cancel</Button>
      </div>
    </form>
  )
}
