import { useEffect, useRef, useState } from 'react'
import { ExternalLink } from 'lucide-react'
import { Link } from 'react-router-dom'
import { api, type AdminAppSettingsResponse } from '../../../lib/api'
import { settingsApi } from '../../../lib/api/settings'
import { useAuthContext } from '../../../contexts/AuthContext'
import { Button, PageHeader, Switch, UnsavedChangesBar, Input, buttonClasses } from '../../../components/ui'
import { useUnsavedChanges } from '../../../components/ui/useUnsavedChanges'
import { useConfirm } from '../../../components/ui/useConfirm'
import { SettingsCatalogContext } from '../../../components/settings/settingsCatalogContext'
import SettingHelp from '../../../components/settings/SettingHelp'

import { PayStubError, payStubsApi } from '../../../lib/payStubsApi'
import {
  emailKeys,
  emailProblem,
  mapServerSettingError,
  normalizeEmails,
  splitEmails,
  validateSetting,
} from '../../../lib/settingsValidation'
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
  // Messages shown under the field they are about, keyed by setting.
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  // Address typed into an email list but not added yet. Saving adds it.
  const [pendingEmail, setPendingEmail] = useState<Record<string, string>>({})
  const [locationOpen, setLocationOpen] = useState<boolean | null>(null)
  const [confirm, dialog] = useConfirm()
  const requireBeforeSchedulesOff = useRef<string | null>(null)
  const baseline = {
    ...data?.settings,
    pay_stub_request_notification_emails: savedEmails,
  } as Record<string, string>
  const withPending = (key: string) =>
    [draft[key], pendingEmail[key]?.trim()].filter(Boolean).join(', ')
  const valueOf = (key: string) => (emailKeys.includes(key) ? withPending(key) : draft[key])
  const changes = Object.fromEntries(
    keys.filter((key) => valueOf(key) !== baseline[key]).map((key) => [key, valueOf(key)]),
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

  const clearFieldError = (...fields: string[]) =>
    setFieldErrors((previous) => {
      if (!fields.some((field) => previous[field])) return previous
      const next = { ...previous }
      for (const field of fields) delete next[field]
      return next
    })

  // Land on the first field that needs attention, in the order they appear on the page.
  const focusField = (key: string) =>
    window.setTimeout(() => {
      const element = document.getElementById(key)
      element?.focus()
      element?.scrollIntoView?.({ block: 'center' })
    }, 0)

  const showFieldErrors = (errors: Record<string, string>) => {
    setFieldErrors(errors)
    const first = keys.find((key) => errors[key])
    if (first) focusField(first)
  }

  const save = async () => {
    const payload = { ...changes }
    setError('')
    setMessage('')
    setFieldErrors({})
    const problems: Record<string, string> = {}
    for (const key of keys) {
      if (payload[key] === undefined) continue
      const problem = validateSetting(key, payload[key], labelFor(key))
      if (problem) problems[key] = problem
    }
    if (Object.keys(problems).length) {
      showFieldErrors(problems)
      return
    }
    for (const key of emailKeys) {
      if (payload[key] === undefined) continue
      payload[key] = normalizeEmails(payload[key]).join(', ')
      if (payload[key] === baseline[key]) delete payload[key]
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
    const fail = (reason: string, field?: { key: string; message: string } | null) => {
      if (field) {
        showFieldErrors({ [field.key]: field.message })
        setError(
          recipientsSaved
            ? 'The heads-up email list was saved, but your other changes were not. Fix the setting marked below and save again.'
            : '',
        )
        return
      }
      setError(
        recipientsSaved
          ? `The heads-up email list was saved, but your other changes were not: ${reason}`
          : reason,
      )
    }
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
        requireBeforeSchedulesOff.current = null
        setData(result.data)
        setDraft({
          ...result.data.settings,
          pay_stub_request_notification_emails: currentRecipients,
        } as Record<string, string>)
        setPendingEmail({})
        setMessage(await savedMessage(settings.schedules_enabled))
      } else {
        const reason = result.error || 'Could not save changes'
        fail(reason, mapServerSettingError(reason, labelFor, (key) => keys.includes(key)))
      }
    } catch (reason) {
      if (reason instanceof PayStubError && reason.code === 'invalid_email') {
        const key = 'pay_stub_request_notification_emails'
        fail(reason.message, { key, message: `${labelFor(key)}: ${reason.message}` })
      } else fail(reason instanceof PayStubError ? reason.message : 'Could not save changes')
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

  const setSwitch = (key: string, checked: boolean) => {
    const next = { ...draft, [key]: String(checked) }
    if (key === 'schedules_enabled') {
      // Require cannot stay on without schedules. Switching schedules back on
      // restores Require to what it was just before they were switched off.
      if (!checked) {
        requireBeforeSchedulesOff.current = draft.schedule_required_for_clock_in ?? 'false'
        next.schedule_required_for_clock_in = 'false'
      } else if (requireBeforeSchedulesOff.current !== null) {
        next.schedule_required_for_clock_in = requireBeforeSchedulesOff.current
        requireBeforeSchedulesOff.current = null
      }
    }
    setDraft(next)
  }
  // Adds what was typed to the list, or says what is wrong with it and keeps the text.
  const addEmails = (key: string) => {
    const typed = pendingEmail[key] ?? ''
    if (!typed.trim()) return
    for (const address of splitEmails(typed)) {
      const problem = emailProblem(address)
      if (problem) {
        showFieldErrors({ [key]: `${labelFor(key)}: ${problem}` })
        return
      }
    }
    clearFieldError(key)
    setDraft((previous) => ({ ...previous, [key]: [previous[key], typed.trim()].filter(Boolean).join(', ') }))
    setPendingEmail((previous) => ({ ...previous, [key]: '' }))
    focusField(key)
  }
  const locationEnforced = draft.clock_in_location_enforced === 'true'
  const showLocation = locationOpen ?? locationEnforced
  const unsaved = useUnsavedChanges({
    dirty,
    what: title,
    saving,
    onSave: () => void save(),
    onDiscard: () => {
      requireBeforeSchedulesOff.current = null
      setDraft({ ...baseline })
      setPendingEmail({})
      setFieldErrors({})
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
          {page === 'kiosk' && (
            <div className="space-y-3 rounded-card border border-line bg-surface p-4">
              <a
                href="/kiosk"
                target="_blank"
                rel="noopener noreferrer"
                className={buttonClasses({ variant: 'primary', size: 'lg' })}
              >
                Open and unlock kiosk
                <ExternalLink className="size-4" aria-hidden="true" />
                <span className="sr-only">(opens in a new tab)</span>
              </a>
              <p className="text-sm text-ink-muted">
                Open this on the shared office device, not on your own computer. A manager or admin
                unlocks it there before staff can enter a PIN.
              </p>
            </div>
          )}
          {keys.length > 0 && (
            <div className="divide-y divide-line rounded-card border border-line bg-surface">
              {keys.map((key) => {
                const entry = data.catalog?.find((item) => item.setting_keys.includes(key))
                const label = labelFor(key)
                const isSwitch = switches.has(key)
                const isEmail = key.endsWith('_emails')
                const fieldError = fieldErrors[key]
                const errorId = fieldError ? `${key}-error` : undefined
                const disabled =
                  (key === 'schedule_required_for_clock_in' && draft.schedules_enabled !== 'true') ||
                  (key === 'pay_stub_request_notification_emails' && !emailsEditable)
                const heading = (
                  <div className="flex items-center gap-2">
                    {isSwitch ? (
                      <span className="font-semibold">{label}</span>
                    ) : (
                      <label htmlFor={key} className="font-semibold">
                        {label}
                      </label>
                    )}
                    {entry && <SettingHelp id={entry.id} />}
                  </div>
                )
                return (
                  <div key={key} className="space-y-2 p-4">
                    {isSwitch ? (
                      <div className="flex items-center justify-between gap-4">
                        {heading}
                        <Switch
                          hideLabel
                          label={label}
                          checked={draft[key] === 'true'}
                          disabled={disabled || saving}
                          onChange={(checked) => setSwitch(key, checked)}
                        />
                      </div>
                    ) : (
                      heading
                    )}
                    {isEmail ? (
                      <EmailChips
                        id={key}
                        label={label}
                        emails={splitEmails(draft[key] ?? '')}
                        pending={pendingEmail[key] ?? ''}
                        disabled={saving || disabled}
                        error={fieldError}
                        onPendingChange={(value) => {
                          clearFieldError(key)
                          setPendingEmail((previous) => ({ ...previous, [key]: value }))
                        }}
                        onAdd={() => addEmails(key)}
                        onRemove={(email) => {
                          clearFieldError(key)
                          setDraft((previous) => ({
                            ...previous,
                            [key]: splitEmails(previous[key] ?? '')
                              .filter((item) => item.toLowerCase() !== email.toLowerCase())
                              .join(', '),
                          }))
                        }}
                      />
                    ) : (
                      !isSwitch && (
                        <>
                          <Input
                            id={key}
                            value={draft[key] ?? ''}
                            disabled={saving}
                            aria-invalid={fieldError ? true : undefined}
                            aria-describedby={errorId}
                            onChange={(event) => {
                              clearFieldError(key)
                              setDraft((previous) => ({ ...previous, [key]: event.target.value }))
                            }}
                            className="min-h-11 w-full rounded-control border border-line px-3 py-2 text-base"
                            inputMode={key === 'clock_in_location_name' ? 'text' : 'decimal'}
                          />
                          {fieldError && (
                            <p id={errorId} className="text-sm font-medium text-danger">
                              {fieldError}
                            </p>
                          )}
                        </>
                      )
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
                        {!draft[key] && !pendingEmail[key] && 'Nobody gets reminders now.'}
                      </p>
                    )}
                  </div>
                )
              })}
            </div>
          )}
          {page === 'kiosk' && (
            <p className="rounded-card border border-line bg-surface p-4 text-ink-muted">
              Pay stub requests at the kiosk are {draft.pay_stub_kiosk_requests_enabled === 'true' ? 'on' : 'off'}.{' '}
              <Link to="/admin/settings/pay-stubs" className="font-semibold text-primary underline">
                Change this in Pay stubs
              </Link>
            </p>
          )}
          {page === 'time-clock' && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-surface p-4">
                <div className="min-w-0">
                  <h2 className="font-semibold">Clock-in location</h2>
                  <p className="text-sm text-ink-muted">
                    {draft.clock_in_location_name || 'No location set'} · location check is{' '}
                    {locationEnforced ? 'on' : 'off'}
                  </p>
                </div>
                <Button
                  variant="secondary"
                  aria-expanded={showLocation}
                  aria-controls="clock-in-location-picker"
                  onClick={() => setLocationOpen(!showLocation)}
                >
                  {showLocation ? 'Hide location search' : 'Change location'}
                </Button>
              </div>
              {showLocation && (
                <div id="clock-in-location-picker">
                  <ClockLocationPicker
                    draft={draft}
                    onChange={(values) => {
                      clearFieldError(...Object.keys(values))
                      setDraft((previous) => ({ ...previous, ...values }))
                    }}
                  />
                </div>
              )}
            </>
          )}
        </SettingsCatalogContext.Provider>
      )}
      <UnsavedChangesBar {...unsaved.barProps} />
      {unsaved.guard}
      {dialog}
    </div>
  )
}
