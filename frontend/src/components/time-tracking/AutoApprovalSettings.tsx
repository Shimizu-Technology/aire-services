import { useState } from 'react'
import { api, type TimeClockAppSettings } from '../../lib/api'
import { Button, Field, HelpTip, Input, useConfirm } from '../ui'

// "Auto-approve ordinary shifts" and its shift-length limit, on the Settings
// page (owners and admins). Off by default. The rules live in
// TimeClockService.ordinary_shift_exceptions; every change is audited.

const DEFAULT_MAX_HOURS = '12'
const MAX_HOURS_LIMIT = 23

interface Props {
  settings: TimeClockAppSettings | null
  onSaved: (settings: TimeClockAppSettings) => void
}

export default function AutoApprovalSettings({ settings, onSaved }: Props) {
  const [confirm, confirmDialog] = useConfirm()
  const [saving, setSaving] = useState<'switch' | 'hours' | null>(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [hoursDraft, setHoursDraft] = useState<string | null>(null)

  const enabled = settings?.auto_approve_ordinary_shifts === 'true'
  const savedHours = settings?.auto_approve_max_shift_hours || DEFAULT_MAX_HOURS
  const hours = hoursDraft ?? savedHours

  const save = async (update: Partial<TimeClockAppSettings>, kind: 'switch' | 'hours', success: string) => {
    setSaving(kind)
    setError('')
    setMessage('')
    try {
      const res = await api.updateAdminAppSettings({ settings: update })
      if (res.error || !res.data) {
        setError(res.error || 'The auto-approval setting could not be saved.')
        return false
      }
      onSaved(res.data.settings)
      setMessage(success)
      return true
    } finally {
      setSaving(null)
    }
  }

  const toggle = async (next: boolean) => {
    if (next) {
      const agreed = await confirm({
        title: 'Turn on auto-approval?',
        description: 'Chels and the CEO must agree before this is turned on. Employees’ ordinary kiosk and mobile shifts will be approved at clock-out without a manager looking at them.',
        details: <p className="text-body-sm text-ink-muted">Overtime, edits, manual entries, missed clock-outs, late hours and supervisors’ own time still go to the queue.</p>,
        confirmLabel: 'Turn on',
      })
      if (!agreed) return
    }
    await save(
      { auto_approve_ordinary_shifts: next ? 'true' : 'false' },
      'switch',
      next ? 'Ordinary shifts are now approved at clock-out.' : 'Every shift goes to the approval queue again.',
    )
  }

  const saveHours = async () => {
    const value = Number(hours)
    if (!Number.isFinite(value) || value < 1 || value > MAX_HOURS_LIMIT) {
      setMessage('')
      setError(`Enter a number of hours from 1 to ${MAX_HOURS_LIMIT}.`)
      return
    }
    if (await save({ auto_approve_max_shift_hours: String(value) }, 'hours', `Shifts of ${value} hours or longer go to the queue.`)) setHoursDraft(null)
  }

  return (
    <section id="auto-approval" className="scroll-mt-6 rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 px-5 py-4">
        <h2 className="text-lg font-semibold text-slate-900">Auto-approval</h2>
        <p className="mt-1 text-sm text-slate-500">
          Changes apply to shifts clocked out after you save, and are recorded in the activity history.
        </p>
      </div>
      <div className="space-y-4 px-5 py-5">
        {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
        {message && <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div>}
        <div className="flex items-start justify-between gap-4 rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <h3 id="auto-approve-label" className="text-sm font-semibold text-slate-900">Auto-approve ordinary shifts</h3>
              <HelpTip
                label="Auto-approve ordinary shifts"
                what="Approves an employee's normal kiosk or mobile shift at clock-out: work category set, no edits, no overtime, no missed clock-out, under the length limit, inside the pay period. Anything else, and every supervisor's own time, waits in the queue."
                defaultValue="Off. Chels and the CEO must agree before it is turned on."
                who="Owners and admins"
                example="Ana clocks in at the kiosk at 8:00 and out at 4:30 with no overtime this week, so her shift shows Auto-approved. Had she corrected her clock-out, it would wait in the queue."
              />
            </div>
            <p id="auto-approve-help" className="mt-1 text-sm text-slate-500">
              Employees only. Overtime is never auto-approved.
            </p>
          </div>
          <label className="inline-flex min-h-[44px] shrink-0 items-center gap-2 text-sm font-medium text-slate-700">
            <input
              type="checkbox"
              checked={enabled}
              disabled={saving !== null || !settings}
              onChange={(event) => void toggle(event.target.checked)}
              aria-labelledby="auto-approve-label"
              aria-describedby="auto-approve-help"
              className="h-4 w-4 rounded border-slate-300 text-cyan-600 focus:ring-cyan-500"
            />
            {saving === 'switch' ? 'Saving…' : enabled ? 'On' : 'Off'}
          </label>
        </div>
        <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-50/70 p-4 sm:flex-row sm:items-end">
          <Field
            className="sm:max-w-xs sm:flex-1"
            label="Longest shift to auto-approve (hours)"
            help="The whole shift counts: first clock-in to final clock-out, breaks and category switches included."
            labelAction={(
              <HelpTip
                label="Longest shift to auto-approve"
                what="A shift that runs this many hours or more, from first clock-in to final clock-out with breaks and category switches included, always waits for a person, and so does every part of it. A shift the system closes for a missed clock-out always waits too, whatever this limit."
                defaultValue="12 hours"
                who="Owners and admins"
                example="At 12, a 7:00 to 18:30 shift is auto-approved. A 6:00 to 19:30 shift that switched category at 17:00 goes to the queue whole, both parts."
              />
            )}
          >
            <Input
              type="number"
              inputMode="decimal"
              step="0.5"
              min="1"
              max={MAX_HOURS_LIMIT}
              value={hours}
              disabled={!settings}
              onChange={(event) => setHoursDraft(event.target.value)}
            />
          </Field>
          <Button
            variant="secondary"
            onClick={() => void saveHours()}
            loading={saving === 'hours'}
            disabled={!settings || saving !== null || hoursDraft === null || hoursDraft === savedHours}
          >
            Save limit
          </Button>
        </div>
      </div>
      {confirmDialog}
    </section>
  )
}
