import { useEffect, useId, useState } from 'react'
import { api, type TimeClockAppSettings } from '../../lib/api'
import { PayStubError, payStubsApi } from '../../lib/payStubsApi'

// The pay stub go-live switches and the heads-up list, on the Settings page
// (owners and admins). Both switches start off. Sending from the Pay stubs
// page works either way. Each change is recorded in the activity history.

type SwitchKey = 'pay_stub_kiosk_requests_enabled' | 'pay_stub_self_email_enabled'

const SWITCHES: { key: SwitchKey; title: string; help: string; on: string; off: string }[] = [
  {
    key: 'pay_stub_kiosk_requests_enabled',
    title: 'Pay stub requests at the kiosk',
    help: 'Adds “Request my pay stub” after a worker enters their PIN. Requests wait on the Pay stubs page for someone to send.',
    on: 'Workers can now request pay stubs at the kiosk.',
    off: 'The kiosk no longer offers pay stub requests.',
  },
  {
    key: 'pay_stub_self_email_enabled',
    title: 'Workers can email themselves stubs',
    help: 'Adds “Email me this stub” to each paycheck in My Pay. The link goes only to the email on file.',
    on: 'Workers with My Pay can now email themselves a stub.',
    off: '“Email me this stub” is no longer shown in My Pay.',
  },
]

const secondary = 'inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-600 disabled:opacity-60'
const primary = 'inline-flex min-h-11 items-center justify-center rounded-xl bg-primary px-4 text-sm font-semibold text-white shadow-sm hover:bg-primary-light focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-60'

function HeadsUpRecipients() {
  const ids = useId()
  const [emails, setEmails] = useState<string[] | null>(null)
  const [draft, setDraft] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [loadAttempt, setLoadAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    payStubsApi.notificationEmails(controller.signal)
      .then((data) => { setEmails(data.emails); setLoadFailed(false) })
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return
        setLoadFailed(true)
        setFeedback({ tone: 'error', text: caught instanceof PayStubError ? caught.message : 'The heads-up list could not be loaded.' })
      })
    return () => controller.abort()
  }, [loadAttempt])

  const save = async () => {
    if (draft === null) return
    setSaving(true)
    setFeedback(null)
    try {
      const result = await payStubsApi.updateNotificationEmails(draft)
      setEmails(result.emails)
      setDraft(null)
      setFeedback({ tone: 'success', text: 'Saved.' })
    } catch (caught) {
      setFeedback({ tone: 'error', text: caught instanceof PayStubError ? caught.message : 'These addresses could not be saved.' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
      <h3 id={`${ids}-title`} className="text-sm font-semibold text-slate-900">Email a heads-up about new kiosk requests</h3>
      <p className="mt-1 text-sm text-slate-500">
        {emails === null ? (loadFailed ? 'The list could not be loaded.' : 'Loading…') : emails.length > 0 ? `New requests are also emailed to ${emails.join(', ')}.` : 'Nobody is emailed now; new requests appear only on the Pay stubs page.'}
        {' '}The heads-up names the person and what they asked for, never pay details.
      </p>
      {emails === null && loadFailed && (
        <button type="button" className={`${secondary} mt-3`} onClick={() => { setFeedback(null); setLoadFailed(false); setLoadAttempt((n) => n + 1) }}>Try again</button>
      )}
      {emails !== null && (draft === null ? (
        <button type="button" className={`${secondary} mt-3`} onClick={() => { setFeedback(null); setDraft(emails.join(', ')) }}>Change recipients</button>
      ) : (
        <div className="mt-3 space-y-2">
          <label htmlFor={`${ids}-emails`} className="block text-sm font-medium text-slate-800">Email addresses, separated by commas</label>
          <textarea id={`${ids}-emails`} rows={2} value={draft} onChange={(event) => setDraft(event.target.value)} autoCapitalize="none" spellCheck={false}
            className="block w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-base focus:border-cyan-600 focus:outline-none focus:ring-2 focus:ring-cyan-600/30 sm:text-sm" />
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" className={secondary} onClick={() => setDraft(null)} disabled={saving}>Cancel</button>
            <button type="button" className={primary} onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save recipients'}</button>
          </div>
        </div>
      ))}
      {feedback && <p role={feedback.tone === 'error' ? 'alert' : 'status'} className={`mt-2 text-sm ${feedback.tone === 'error' ? 'text-red-700' : 'text-emerald-800'}`}>{feedback.text}</p>}
    </div>
  )
}

interface Props {
  settings: TimeClockAppSettings | null
  onSaved: (settings: TimeClockAppSettings) => void
}

export default function PayStubSettings({ settings, onSaved }: Props) {
  const [saving, setSaving] = useState<SwitchKey | null>(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const change = async (key: SwitchKey, enabled: boolean) => {
    setSaving(key)
    setError('')
    setMessage('')
    try {
      const update: Partial<TimeClockAppSettings> = key === 'pay_stub_kiosk_requests_enabled'
        ? { pay_stub_kiosk_requests_enabled: enabled ? 'true' : 'false' }
        : { pay_stub_self_email_enabled: enabled ? 'true' : 'false' }
      const res = await api.updateAdminAppSettings({ settings: update })
      if (res.error || !res.data) {
        setError(res.error || 'The pay stub setting could not be saved.')
        return
      }
      onSaved(res.data.settings)
      const item = SWITCHES.find((candidate) => candidate.key === key)
      setMessage((enabled ? item?.on : item?.off) ?? 'Saved.')
    } finally {
      setSaving(null)
    }
  }

  return (
    <section id="pay-stubs" className="scroll-mt-6 rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 px-5 py-4">
        <h2 className="text-lg font-semibold text-slate-900">Pay stubs</h2>
        <p className="mt-1 text-sm text-slate-500">
          Owners, admins and managers can always send stubs from the Pay stubs page. These choose what workers can do themselves. Changes apply right away and are recorded in the activity history.
        </p>
      </div>
      <div className="space-y-4 px-5 py-5">
        {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
        {message && <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div>}
        {SWITCHES.map((item) => {
          const checked = settings?.[item.key] === 'true'
          return (
            <div key={item.key} className="flex items-start justify-between gap-4 rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
              <div>
                <h3 id={`${item.key}-label`} className="text-sm font-semibold text-slate-900">{item.title}</h3>
                <p id={`${item.key}-help`} className="mt-1 text-sm text-slate-500">{item.help}</p>
              </div>
              <label className="inline-flex min-h-[44px] shrink-0 items-center gap-2 text-sm font-medium text-slate-700">
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={saving !== null || !settings}
                  onChange={(event) => void change(item.key, event.target.checked)}
                  aria-labelledby={`${item.key}-label`}
                  aria-describedby={`${item.key}-help`}
                  className="h-4 w-4 rounded border-slate-300 text-cyan-600 focus:ring-cyan-500"
                />
                {saving === item.key ? 'Saving…' : checked ? 'On' : 'Off'}
              </label>
            </div>
          )
        })}
        <HeadsUpRecipients />
      </div>
    </section>
  )
}
