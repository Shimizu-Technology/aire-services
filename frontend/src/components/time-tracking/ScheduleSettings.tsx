import { useState } from 'react'
import { useAuthContext } from '../../contexts/AuthContext'
import { api, type TimeClockAppSettings } from '../../lib/api'
import SettingHelp from '../settings/SettingHelp'

// "Use schedules" on the Settings page (owners and admins). Off by default:
// AIRE doesn't plan shifts in the app yet. It only shows or hides the
// Schedule pages; clock-in rules don't read it. Each change is recorded in
// the activity history.

interface Props {
  settings: TimeClockAppSettings | null
  onSaved: (settings: TimeClockAppSettings) => void
}

export default function ScheduleSettings({ settings, onSaved }: Props) {
  const { refreshCurrentUser } = useAuthContext()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const checked = settings?.schedules_enabled === 'true'
  const scheduleRequired = settings?.schedule_required_for_clock_in === 'true'

  const change = async (enabled: boolean) => {
    setSaving(true)
    setError('')
    setMessage('')
    try {
      const res = await api.updateAdminAppSettings({ settings: { schedules_enabled: enabled ? 'true' : 'false' } })
      if (res.error || !res.data) {
        setError(res.error || 'The schedule setting could not be saved.')
        return
      }
      onSaved(res.data.settings)
      // The menu reads this from the signed-in profile. Refresh it in the
      // background so this page stays put, and only then say the menu changed.
      const refreshed = await refreshCurrentUser({ background: true }).catch(() => false)
      if (refreshed) {
        setMessage(enabled ? 'Schedule is now in everyone’s menu.' : 'Schedule is hidden from the menu.')
      } else {
        setMessage(enabled ? 'Saved. Schedule will appear in the menu shortly.' : 'Saved. Schedule will leave the menu shortly.')
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <section id="use-schedules" className="scroll-mt-6 rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 px-5 py-4">
        <h2 className="text-lg font-semibold text-slate-900">Schedules</h2>
        <p className="mt-1 text-sm text-slate-500">Changes apply right away and are recorded in the activity history.</p>
      </div>
      <div className="space-y-4 px-5 py-5">
        {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
        {message && <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div>}
        <div className="flex items-start justify-between gap-4 rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
          <div>
            <h3 id="use-schedules-label" className="flex items-center gap-1 text-sm font-semibold text-slate-900">
              Use schedules
              <SettingHelp id="schedules_enabled" />
            </h3>
            <p id="use-schedules-help" className="mt-1 text-sm text-slate-500">
              Shows Schedule in everyone’s menu. Shifts already entered still set the early clock-in window and the attendance badge either way.
            </p>
          </div>
          <label className="inline-flex min-h-[44px] shrink-0 items-center gap-2 text-sm font-medium text-slate-700">
            <input
              type="checkbox"
              checked={checked}
              disabled={saving || !settings}
              onChange={(event) => void change(event.target.checked)}
              aria-labelledby="use-schedules-label"
              aria-describedby="use-schedules-help"
              className="h-4 w-4 rounded border-slate-300 text-cyan-600 focus:ring-cyan-500"
            />
            {saving ? 'Saving…' : checked ? 'On' : 'Off'}
          </label>
        </div>
        {scheduleRequired && !checked && (
          <p role="note" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Clock-in currently requires a scheduled shift, so anyone without one can’t clock in. Turn schedules on to add shifts.
          </p>
        )}
      </div>
    </section>
  )
}
