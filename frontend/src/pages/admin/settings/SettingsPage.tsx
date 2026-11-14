import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type AdminAppSettingsResponse } from '../../../lib/api'
import { settingsApi } from '../../../lib/api/settings'
import { PageHeader, Switch, UnsavedChangesBar, Input } from '../../../components/ui'
import { useUnsavedChanges } from '../../../components/ui/useUnsavedChanges'
import { useConfirm } from '../../../components/ui/useConfirm'
import { SettingsCatalogContext } from '../../../components/settings/settingsCatalogContext'
import SettingHelp from '../../../components/settings/SettingHelp'

import { payStubsApi } from '../../../lib/payStubsApi'
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

export default function SettingsPage({ page }: { page: SettingsPageId }) {
  const { title, keys } = settingsPages[page]
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
    void api
      .getAdminAppSettings()
      .then(async (result) => {
        if (result.data) {
          setData(result.data)
          const next = { ...result.data.settings } as Record<string, string>
          if (page === 'pay-stubs') {
            const recipients = await payStubsApi.notificationEmails()
            setSavedEmails(recipients.emails.join(', '))
            setEmailsEditable(recipients.editable)
            next.pay_stub_request_notification_emails = recipients.emails.join(', ')
          }
          setDraft(next)
        } else setError(result.error || 'Could not load settings')
      })
      .catch(() => setError('Could not load settings'))
  }
  useEffect(load, [page])
  useEffect(() => {
    document.title = `${title} | AIRE Ops`
  }, [title])

  const save = async (override?: Record<string, string>) => {
    const payload = override ?? changes
    setError('')
    const emails = (payload.payroll_cutoff_reminder_emails ?? '')
      .split(/[\n,;]+/)
      .map((value) => value.trim())
      .filter(Boolean)
    if (emails.some((email) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
      setError('Enter valid reminder email addresses')
      return
    }
    for (const key of ['auto_approve_ordinary_shifts', 'schedules_enabled']) {
      if (payload[key] !== undefined && payload[key] !== baseline[key]) {
        const label = key === 'schedules_enabled' ? 'Use schedules' : 'Auto-approve ordinary shifts'
        if (
          !(await confirm({
            title: `Change ${label}?`,
            description: 'This changes how your team tracks and approves time.',
            confirmLabel: 'Save changes',
          }))
        )
          return
      }
    }
    setSaving(true)
    try {
      const { pay_stub_request_notification_emails: recipients, ...settings } = payload
      if (recipients !== undefined) {
        const saved = await payStubsApi.updateNotificationEmails(recipients)
        setSavedEmails(saved.emails.join(', '))
      }
      const result = Object.keys(settings).length
        ? await settingsApi.save(settings)
        : { data: data! }
      if (result.data) {
        setData(result.data)
        setDraft({
          ...result.data.settings,
          pay_stub_request_notification_emails: recipients ?? savedEmails,
        } as Record<string, string>)
        setMessage('Changes saved')
      } else setError(result.error || 'Could not save changes')
    } catch {
      setError('Could not save changes')
    } finally {
      setSaving(false)
    }
  }
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
        <div role="alert">
          {error}
          <button type="button" onClick={load}>
            Reload settings
          </button>
        </div>
      )}
      {message && <p role="status">{message}</p>}
      {!data ? (
        <p>Loading settings…</p>
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
                  onClick={() => void save({ schedule_required_for_clock_in: 'false' })}
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
              const label =
                key === 'clock_in_location_latitude'
                  ? 'Latitude'
                  : key === 'clock_in_location_longitude'
                    ? 'Longitude'
                    : (entry?.label ?? key.replaceAll('_', ' '))
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
                      onChange={(checked) =>
                        setDraft((previous) => ({ ...previous, [key]: String(checked) }))
                      }
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
