import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type AdminAppSettingsResponse } from '../../../lib/api'
import { settingsApi } from '../../../lib/api/settings'
import { useAuthContext } from '../../../contexts/AuthContext'
import { PageHeader, Switch, UnsavedChangesBar, Input } from '../../../components/ui'
import { useUnsavedChanges } from '../../../components/ui/useUnsavedChanges'
import { useConfirm } from '../../../components/ui/useConfirm'
import { SettingsCatalogContext } from '../../../components/settings/settingsCatalogContext'
import SettingHelp from '../../../components/settings/SettingHelp'

import { PayStubError, payStubsApi } from '../../../lib/payStubsApi'
import ClockLocationPicker from './ClockLocationPicker'
import EmailChips from './EmailChips'

import { settingsPages, type SettingsPageId } from './settingsPages'

const switches = new Set([
  'clock_in_location_enforced',
  'managers_can_approve_own_time',
  'auto_approve_ordinary_shifts',
  'pay_stub_kiosk_requests_enabled',
  'pay_stub_self_email_enabled',
  'schedules_enabled',
  'schedule_required_for_clock_in',
])

const emailKeys = ['payroll_cutoff_reminder_emails', 'pay_stub_request_notification_emails']

// Same rules as the server: split on commas, semicolons and new lines, drop repeats ignoring case.
const normalizeEmails = (value: string) => [
  ...new Set(
    value
      .split(/[\n,;]+/)
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  ),
]

const MAX_RECIPIENTS = 10

// The same pattern the server checks reminder recipients against (URI::MailTo::EMAIL_REGEXP).
const emailPattern =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/

// Fields that cannot be left empty. The server ignores a blank value, so catch it here.
const requiredValues: Record<string, { ask: string; number: boolean }> = {
  overtime_daily_threshold_hours: { ask: 'Enter a number of hours', number: true },
  overtime_weekly_threshold_hours: { ask: 'Enter a number of hours', number: true },
  auto_approve_max_shift_hours: { ask: 'Enter a number of hours', number: true },
  early_clock_in_buffer_minutes: { ask: 'Enter a number of minutes', number: true },
  clock_in_location_radius_meters: { ask: 'Enter a distance in meters', number: true },
  clock_in_location_latitude: { ask: 'Enter a latitude, such as 13.46913', number: true },
  clock_in_location_longitude: { ask: 'Enter a longitude, such as 144.79901', number: true },
  clock_in_location_name: { ask: 'Enter a location name', number: false },
}

// Keyed by page so moving between settings pages never shows the last page's values.
export default function SettingsPage({ page }: { page: SettingsPageId }) {
  return <SettingsForm key={page} page={page} />
}

function SettingsForm({ page }: { page: SettingsPageId }) {
  const { title, keys } = settingsPages[page]
  const { refreshCurrentUser } = useAuthContext()
  const [data, setData] = useState<AdminAppSettingsResponse | null>(null)
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [savedEmails, setSavedEmails] = useState('')
  const [emailsEditable, setEmailsEditable] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)
  const [confirm, dialog] = useConfirm()
  const baseline = {
    ...data?.settings,
    pay_stub_request_notification_emails: savedEmails,
  } as Record<string, string>
  const changes = Object.fromEntries(
    keys.filter((key) => draft[key] !== baseline[key]).map((key) => [key, draft[key]]),
  )
  const dirty = !!data && Object.keys(changes).length > 0
  const load = () => {
    setError('')
    void (async () => {
      const result = await api.getAdminAppSettings()
      if (!result.data) {
        setError(result.error || 'Could not load settings')
        return
      }
      const next = { ...result.data.settings } as Record<string, string>
      if (page === 'pay-stubs') {
        const recipients = await payStubsApi.notificationEmails()
        next.pay_stub_request_notification_emails = recipients.emails.join(', ')
        setSavedEmails(next.pay_stub_request_notification_emails)
        setEmailsEditable(recipients.editable)
      }
      // Everything lands together, so the form never shows half-loaded switches.
      setDraft(next)
      setData(result.data)
      setError('')
    })().catch((reason) =>
      setError(
        reason instanceof PayStubError
          ? `Could not load the heads-up email list. ${reason.message}`
          : 'Could not load settings',
      ),
    )
  }
  useEffect(load, [page])
  useEffect(() => {
    if (dirty) setMessage('')
  }, [dirty])
  useEffect(() => {
    document.title = `${title} | AIRE Ops`
  }, [title])

  const labelFor = (key: string) =>
    key === 'clock_in_location_latitude'
      ? 'Latitude'
      : key === 'clock_in_location_longitude'
        ? 'Longitude'
        : (data?.catalog?.find((item) => item.setting_keys.includes(key))?.label ??
          key.replaceAll('_', ' '))

  const save = async () => {
    const payload = { ...changes }
    setError('')
    setMessage('')
    for (const [key, rule] of Object.entries(requiredValues)) {
      if (payload[key] === undefined) continue
      const value = payload[key].trim()
      if (!value || (rule.number && !Number.isFinite(Number(value)))) {
        setError(`${labelFor(key)}: ${rule.ask}.`)
        return
      }
    }
    for (const key of emailKeys) {
      if (payload[key] === undefined) continue
      payload[key] = normalizeEmails(payload[key]).join(', ')
      if (payload[key] === baseline[key]) delete payload[key]
    }
    const reminders = normalizeEmails(payload.payroll_cutoff_reminder_emails ?? '')
    if (reminders.some((email) => !emailPattern.test(email))) {
      setError('Enter valid reminder email addresses')
      return
    }
    for (const key of emailKeys) {
      if (normalizeEmails(payload[key] ?? '').length > MAX_RECIPIENTS) {
        setError(`Use ${MAX_RECIPIENTS} addresses or fewer.`)
        return
      }
    }
    if (payload.auto_approve_ordinary_shifts !== undefined) {
      const turningOn = payload.auto_approve_ordinary_shifts === 'true'
      if (
        !(await confirm(
          turningOn
            ? {
                title: 'Turn on auto-approval?',
                description:
                  'Chels and the CEO must agree before this is turned on. Employees’ ordinary kiosk and mobile shifts will be approved at clock-out without a manager looking at them.',
                details: (
                  <p className="text-body-sm text-ink-muted">
                    Overtime, edits, manual entries, missed clock-outs, late hours and supervisors’
                    own time still go to the queue.
                  </p>
                ),
                confirmLabel: 'Turn on',
              }
            : {
                title: 'Change Auto-approve ordinary shifts?',
                description: 'This changes how your team tracks and approves time.',
                confirmLabel: 'Save changes',
              },
        ))
      )
        return
    }
    if (payload.schedules_enabled !== undefined) {
      const turnsOffRequire =
        payload.schedules_enabled === 'false' && baseline.schedule_required_for_clock_in === 'true'
      if (
        !(await confirm({
          title: 'Change Use schedules?',
          description: turnsOffRequire
            ? 'This also turns off Require a scheduled shift, so everyone can clock in.'
            : 'This changes how your team tracks and approves time.',
          confirmLabel: 'Save changes',
        }))
      )
        return
    }
    setSaving(true)
    let recipientsSaved = false
    let currentRecipients = savedEmails
    const fail = (reason: string) =>
      setError(
        recipientsSaved
          ? `The heads-up email list was saved, but your other changes were not: ${reason}`
          : reason,
      )
    try {
      const { pay_stub_request_notification_emails: recipients, ...settings } = payload
      if (recipients !== undefined) {
        const saved = await payStubsApi.updateNotificationEmails(recipients)
        currentRecipients = saved.emails.join(', ')
        recipientsSaved = true
        setSavedEmails(currentRecipients)
        setDraft((previous) => ({
          ...previous,
          pay_stub_request_notification_emails: currentRecipients,
        }))
      }
      const result = Object.keys(settings).length
        ? await settingsApi.save(settings)
        : { data: data! }
      if (result.data) {
        setData(result.data)
        setDraft({
          ...result.data.settings,
          pay_stub_request_notification_emails: currentRecipients,
        } as Record<string, string>)
        setMessage(await savedMessage(settings.schedules_enabled))
      } else fail(result.error || 'Could not save changes')
    } catch (reason) {
      fail(reason instanceof PayStubError ? reason.message : 'Could not save changes')
    } finally {
      setSaving(false)
    }
  }

  // The menu reads Use schedules from the signed-in profile, so refresh it in
  // the background and say what the menu now does.
  const savedMessage = async (schedules?: string) => {
    if (schedules === undefined) return 'Changes saved'
    const refreshed = await refreshCurrentUser({ background: true }).catch(() => false)
    const on = schedules === 'true'
    if (refreshed)
      return `Changes saved. ${on ? 'Schedule is now in everyone’s menu.' : 'Schedule is hidden from the menu.'}`
    return `Changes saved. Schedule will ${on ? 'appear in' : 'leave'} the menu shortly.`
  }

  // Only this key is sent and merged, so other unsaved edits stay on screen.
  const turnOffRequire = async () => {
    setError('')
    setMessage('')
    setSaving(true)
    try {
      const result = await settingsApi.save({ schedule_required_for_clock_in: 'false' })
      if (result.data) {
        setData(result.data)
        setDraft((previous) => ({
          ...previous,
          schedule_required_for_clock_in: String(result.data!.settings.schedule_required_for_clock_in),
        }))
        setMessage('Changes saved')
      } else setError(result.error || 'Could not save changes')
    } catch {
      setError('Could not save changes')
    } finally {
      setSaving(false)
    }
  }

  const setSwitch = (key: string, checked: boolean) =>
    setDraft((previous) => {
      const next = { ...previous, [key]: String(checked) }
      if (key === 'schedules_enabled') {
        // Require cannot stay on without schedules; coming back restores what was saved.
        if (!checked && previous.schedule_required_for_clock_in === 'true')
          next.schedule_required_for_clock_in = 'false'
        if (checked && baseline.schedules_enabled === 'true')
          next.schedule_required_for_clock_in = baseline.schedule_required_for_clock_in
      }
      return next
    })
  const unsaved = useUnsavedChanges({
    dirty,
    what: title,
    saving,
    onSave: () => void save(),
    onDiscard: () => {
      setDraft({ ...baseline })
      setError('')
      setMessage('')
    },
  })
  return (
    <div className="mx-auto max-w-[880px] space-y-6 pb-24">
      <Link to="/admin/settings" className="inline-flex min-h-11 items-center text-primary">
        Settings
      </Link>
      <PageHeader title={title} />
      {error && (
        <div
          role="alert"
          className="rounded-card border border-red-300 bg-red-50 p-4 text-red-800"
        >
          <p>{error}</p>
          <button type="button" onClick={load} className="min-h-11 underline">
            Reload settings
          </button>
        </div>
      )}
      {message && <p role="status">{message}</p>}
      {!data ? (
        !error && <p>Loading settings…</p>
      ) : (
        <SettingsCatalogContext.Provider value={data.catalog ?? []}>
          {page === 'schedules' &&
            baseline.schedule_required_for_clock_in === 'true' &&
            baseline.schedules_enabled !== 'true' && (
              <div
                role="alert"
                className="rounded-card border border-red-300 bg-red-50 p-4 text-red-800"
              >
                <p>Nobody without a shift can clock in right now</p>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void turnOffRequire()}
                  className="min-h-11 underline"
                >
                  Turn off Require
                </button>
              </div>
            )}
          {page === 'time-clock' && (
            <ClockLocationPicker
              draft={draft}
              onChange={(values) => setDraft((previous) => ({ ...previous, ...values }))}
            />
          )}
          <div className="divide-y divide-line rounded-card border border-line bg-surface">
            {keys.map((key) => {
              const entry = data.catalog?.find((item) => item.setting_keys.includes(key))
              const label = labelFor(key)
              const disabled =
                (key === 'schedule_required_for_clock_in' && draft.schedules_enabled !== 'true') ||
                (key === 'pay_stub_request_notification_emails' && !emailsEditable)
              return (
                <div key={key} className="space-y-2 p-4">
                  <div className="flex items-center gap-2">
                    <label htmlFor={key} className="font-semibold">
                      {label}
                    </label>
                    {entry && <SettingHelp id={entry.id} />}
                  </div>
                  {switches.has(key) ? (
                    <Switch
                      label={label}
                      checked={draft[key] === 'true'}
                      disabled={disabled || saving}
                      onChange={(checked) => setSwitch(key, checked)}
                    />
                  ) : key.endsWith('_emails') ? (
                    <EmailChips
                      id={key}
                      value={draft[key] ?? ''}
                      disabled={saving || disabled}
                      onChange={(value) => setDraft((previous) => ({ ...previous, [key]: value }))}
                    />
                  ) : (
                    <Input
                      id={key}
                      value={draft[key] ?? ''}
                      disabled={saving}
                      onChange={(event) =>
                        setDraft((previous) => ({ ...previous, [key]: event.target.value }))
                      }
                      className="min-h-11 w-full rounded-control border border-line px-3 py-2 text-base"
                      inputMode={
                        key === 'payroll_cutoff_reminder_emails'
                          ? 'email'
                          : key === 'clock_in_location_name'
                            ? 'text'
                            : 'decimal'
                      }
                    />
                  )}
                  {key === 'schedule_required_for_clock_in' && (
                    <p className="text-sm text-ink-muted">
                      Turn on Use schedules first. When on, anyone without a shift that day can't
                      clock in.
                    </p>
                  )}
                  {key === 'payroll_cutoff_reminder_emails' && (
                    <p className="text-sm text-ink-muted">
                      Who gets the reminder before each lock.{' '}
                      {!draft[key] && 'Nobody gets reminders now.'}
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        </SettingsCatalogContext.Provider>
      )}
      <UnsavedChangesBar {...unsaved.barProps} />
      {unsaved.guard}
      {dialog}
    </div>
  )
}
