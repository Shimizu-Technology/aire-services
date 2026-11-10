import { useEffect, useId, useState } from 'react'
import { formatPayDate } from '../../lib/myPayApi'
import { PayStubError, kioskPayStubsApi, type KioskPayStubChoices, type PayStubScope } from '../../lib/payStubsApi'

// "Request my pay stub" on the shared kiosk, after the PIN. The kiosk only
// ever shows pay dates and a masked email; the office sends the stub.

interface Props {
  kioskAccessToken: string
  kioskToken: string
  /** Any tap or keystroke here, so the kiosk's idle reset doesn't fire mid-request. */
  onActivity: () => void
  onCancel: () => void
  onSent: (message: string) => void
}

const SCOPES: { value: PayStubScope; label: string; help: string }[] = [
  { value: 'latest', label: 'My latest pay stub', help: 'The most recent paycheck' },
  { value: 'pay_date', label: 'A specific pay date', help: 'Pick the date from a list' },
  { value: 'year', label: 'A whole year', help: 'Every pay stub for one year' },
]

const optionClass = (selected: boolean) =>
  `flex min-h-14 w-full items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-left transition select-none touch-manipulation ${
    selected ? 'border-cyan-300 bg-cyan-400/15 text-white' : 'border-slate-700 bg-slate-900/40 text-slate-200 hover:border-slate-500'
  }`

const inputClass = 'mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-base text-white placeholder:text-slate-500 focus:border-cyan-300 focus:outline-none focus:ring-2 focus:ring-cyan-300/40'

export default function KioskPayStubRequest({ kioskAccessToken, kioskToken, onActivity, onCancel, onSent }: Props) {
  const ids = useId()
  const [choices, setChoices] = useState<KioskPayStubChoices | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [scope, setScope] = useState<PayStubScope>('latest')
  const [statementId, setStatementId] = useState<string | null>(null)
  const [year, setYear] = useState<number | null>(null)
  const [destination, setDestination] = useState<'on_file' | 'typed'>('on_file')
  const [email, setEmail] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let current = true
    kioskPayStubsApi.choices(kioskAccessToken, kioskToken)
      .then((data) => {
        if (!current) return
        setChoices(data)
        setYear(data.years[0] ?? null)
        if (!data.on_file_email_hint) setDestination('typed')
      })
      .catch((caught: unknown) => {
        if (current) setLoadError(caught instanceof PayStubError ? caught.message : 'Pay stub requests are unavailable right now.')
      })
    return () => { current = false }
  }, [kioskAccessToken, kioskToken])

  const touch = <T,>(setter: (value: T) => void) => (value: T) => {
    onActivity()
    setError(null)
    setter(value)
  }

  const typedMismatch = destination === 'typed' && confirmation.length > 0 && email.trim().toLowerCase() !== confirmation.trim().toLowerCase()
  const ready = Boolean(choices)
    && (scope !== 'pay_date' || statementId !== null)
    && (scope !== 'year' || year !== null)
    && (destination === 'on_file' || (email.trim().length > 3 && email.trim().toLowerCase() === confirmation.trim().toLowerCase()))

  const submit = async () => {
    if (!ready || submitting) return
    onActivity()
    setSubmitting(true)
    setError(null)
    try {
      const result = await kioskPayStubsApi.request(kioskAccessToken, kioskToken, {
        scope,
        statementId: scope === 'pay_date' ? statementId ?? undefined : undefined,
        year: scope === 'year' ? year ?? undefined : undefined,
        ...(destination === 'typed' ? { email: email.trim(), emailConfirmation: confirmation.trim() } : {}),
      })
      onSent(result.message)
    } catch (caught) {
      setError(caught instanceof PayStubError ? caught.message : 'Your request could not be sent. Please try again.')
      setSubmitting(false)
    }
  }

  if (loadError) {
    return (
      <div className="mt-8 space-y-3">
        <p role="alert" className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">{loadError}</p>
        <button type="button" onClick={onCancel} className="rounded-xl border border-slate-700 px-4 py-3 text-sm font-semibold text-slate-200">Back</button>
      </div>
    )
  }

  if (!choices) {
    return <p role="status" className="mt-8 rounded-2xl border border-slate-800 bg-slate-900/50 px-4 py-4 text-sm text-slate-300">Loading your pay dates…</p>
  }

  const datesUnavailable = !choices.pay_dates_available || choices.pay_dates.length === 0

  return (
    <section aria-labelledby={`${ids}-title`} className="mt-8 space-y-6">
      <div>
        <h2 id={`${ids}-title`} className="text-xl font-semibold text-white">Request my pay stub</h2>
        <p className="mt-1 text-sm text-slate-400">The office will email you a secure link to download it.</p>
      </div>

      <fieldset className="space-y-2">
        <legend className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Which pay stub?</legend>
        {SCOPES.map((option) => {
          const disabled = option.value === 'pay_date' && datesUnavailable
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={scope === option.value}
              disabled={disabled}
              onClick={() => touch(setScope)(option.value)}
              className={`${optionClass(scope === option.value)} disabled:cursor-not-allowed disabled:opacity-50`}
            >
              <span>
                <span className="block font-medium">{option.label}</span>
                <span className="mt-0.5 block text-xs text-slate-400">{disabled ? "Pay dates can't be loaded right now" : option.help}</span>
              </span>
            </button>
          )
        })}
      </fieldset>

      {scope === 'pay_date' && (
        <fieldset>
          <legend className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Pay date</legend>
          <div className="grid max-h-64 grid-cols-2 gap-2 overflow-y-auto overscroll-contain pr-1 sm:grid-cols-3">
            {choices.pay_dates.map((option) => (
              <button
                key={option.statement_id}
                type="button"
                aria-pressed={statementId === option.statement_id}
                onClick={() => touch(setStatementId)(option.statement_id)}
                className={`${optionClass(statementId === option.statement_id)} justify-center text-center text-sm font-medium`}
              >
                {formatPayDate(option.pay_date)}
              </button>
            ))}
          </div>
        </fieldset>
      )}

      {scope === 'year' && (
        <fieldset>
          <legend className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Year</legend>
          <div className="flex flex-wrap gap-2">
            {choices.years.map((option) => (
              <button key={option} type="button" aria-pressed={year === option} onClick={() => touch(setYear)(option)} className={`${optionClass(year === option)} w-auto min-w-24 justify-center font-medium`}>
                {option}
              </button>
            ))}
          </div>
        </fieldset>
      )}

      <fieldset className="space-y-2">
        <legend className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Where should we email it?</legend>
        {choices.on_file_email_hint && (
          <button type="button" aria-pressed={destination === 'on_file'} onClick={() => touch(setDestination)('on_file')} className={optionClass(destination === 'on_file')}>
            <span>
              <span className="block font-medium">My email on file</span>
              <span className="mt-0.5 block text-sm text-slate-400">{choices.on_file_email_hint}</span>
            </span>
          </button>
        )}
        <button type="button" aria-pressed={destination === 'typed'} onClick={() => touch(setDestination)('typed')} className={optionClass(destination === 'typed')}>
          <span className="block font-medium">{choices.on_file_email_hint ? 'A different email' : 'Type my email'}</span>
        </button>
        {!choices.on_file_email_hint && <p className="text-sm text-slate-400">There&apos;s no email on file for you, so type the one you&apos;d like to use.</p>}
        {destination === 'typed' && (
          <div className="space-y-3 pt-2">
            <label className="block text-sm text-slate-300" htmlFor={`${ids}-email`}>
              Email
              <input id={`${ids}-email`} type="email" inputMode="email" autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="next"
                value={email} onChange={(event) => touch(setEmail)(event.target.value)} className={inputClass} />
            </label>
            <label className="block text-sm text-slate-300" htmlFor={`${ids}-confirm`}>
              Type it again
              <input id={`${ids}-confirm`} type="email" inputMode="email" autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="done"
                value={confirmation} onChange={(event) => touch(setConfirmation)(event.target.value)} onPaste={(event) => event.preventDefault()}
                aria-invalid={typedMismatch} aria-describedby={typedMismatch ? `${ids}-mismatch` : undefined} className={inputClass} />
            </label>
            {typedMismatch && <p id={`${ids}-mismatch`} className="text-sm text-amber-200">The two emails don&apos;t match yet.</p>}
          </div>
        )}
      </fieldset>

      {error && <p role="alert" className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</p>}

      <div className="grid gap-3 sm:grid-cols-2">
        <button type="button" onClick={submit} disabled={!ready || submitting} className={`rounded-2xl px-5 py-3.5 text-sm font-semibold transition select-none touch-manipulation ${
          !ready || submitting ? 'cursor-not-allowed bg-slate-800 text-slate-500' : 'bg-cyan-400 text-slate-950 hover:bg-cyan-300 active:scale-[0.98]'
        }`}>
          {submitting ? 'Sending request…' : 'Send request to the office'}
        </button>
        <button type="button" onClick={onCancel} disabled={submitting} className="rounded-2xl border border-slate-700 px-5 py-3.5 text-sm font-semibold text-slate-200 transition hover:border-slate-500">
          Cancel
        </button>
      </div>
    </section>
  )
}
