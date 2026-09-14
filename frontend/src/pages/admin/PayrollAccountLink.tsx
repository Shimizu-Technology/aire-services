import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, Check, Link2, Loader2, ShieldCheck, Unplug } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { api, type PayrollAccountLinkSession } from '../../lib/api'

const permissions = [
  'Review and approve time and overtime',
  'Correct time entries with an audit trail',
  'Lock and finalize published payroll periods',
  'Route held-time and settlement exceptions',
]

function callbackWithResult(rawUrl: string, result: string) {
  const url = new URL(rawUrl)
  url.searchParams.set('aire_link', result)
  return url.toString()
}

export default function PayrollAccountLink() {
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token') || ''
  const [session, setSession] = useState<PayrollAccountLinkSession | null>(null)
  const [loading, setLoading] = useState(true)
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    const load = async () => {
      if (!token) {
        setError('This connection link is incomplete. Return to Cornerstone and start again.')
        setLoading(false)
        return
      }

      const response = await api.getPayrollAccountLinkSession(token)
      if (!active) return
      if (response.error || !response.data?.account_link_session) {
        setError(response.error || 'This connection request is invalid or has expired.')
      } else {
        setSession(response.data.account_link_session)
      }
      setLoading(false)
    }
    void load()
    return () => { active = false }
  }, [token])

  const cancelUrl = useMemo(
    () => session ? callbackWithResult(session.return_url, 'cancelled') : null,
    [session]
  )

  const connect = async () => {
    if (!token) return
    setConnecting(true)
    setError(null)
    const response = await api.authorizePayrollAccountLink(token)
    if (response.error || !response.data?.redirect_url) {
      setError(response.error || 'AIRE could not connect these accounts. Please try again.')
      setConnecting(false)
      return
    }
    window.location.assign(response.data.redirect_url)
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
      <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-[0_24px_70px_-44px_rgba(15,23,42,0.7)]">
        <div className="relative overflow-hidden bg-slate-950 px-6 py-8 text-white sm:px-9">
          <div className="absolute -right-12 -top-20 h-52 w-52 rounded-full bg-cyan-400/15 blur-3xl" aria-hidden="true" />
          <div className="relative flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-cyan-300/25 bg-cyan-300/10">
              <Link2 className="h-6 w-6 text-cyan-300" aria-hidden="true" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300">One-time connection</p>
              <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">Connect AIRE to Cornerstone Payroll</h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">
                Confirm once, then manage AIRE payroll work from Cornerstone without copying tokens or reconnecting every 90 days.
              </p>
            </div>
          </div>
        </div>

        <div className="p-6 sm:p-9">
          {loading && (
            <div className="flex min-h-52 items-center justify-center gap-3 text-sm text-slate-600" role="status">
              <Loader2 className="h-5 w-5 animate-spin text-cyan-700" aria-hidden="true" />
              Checking this connection request…
            </div>
          )}

          {!loading && error && !session && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm leading-6 text-amber-950" role="alert">
              <p className="font-semibold">This connection cannot continue</p>
              <p className="mt-1">{error}</p>
            </div>
          )}

          {!loading && session && (
            <div className="space-y-7">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Cornerstone account</p>
                  <p className="mt-2 break-words text-sm font-semibold text-slate-950">{session.external_actor_email || 'Your signed-in payroll account'}</p>
                </div>
                <div className="rounded-2xl border border-cyan-200 bg-cyan-50 px-4 py-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-cyan-800">AIRE account</p>
                  <p className="mt-2 text-sm font-semibold text-slate-950">{session.aire_user.name}</p>
                  {session.aire_user.email && <p className="mt-1 break-words text-xs text-slate-600">{session.aire_user.email}</p>}
                </div>
              </div>

              <div>
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-5 w-5 text-cyan-700" aria-hidden="true" />
                  <h2 className="font-semibold text-slate-950">Cornerstone will be able to</h2>
                </div>
                <ul className="mt-4 grid gap-3 sm:grid-cols-2">
                  {permissions.map((permission) => (
                    <li key={permission} className="flex items-start gap-2 text-sm leading-5 text-slate-700">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
                      {permission}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm leading-6 text-slate-700">
                This connection does not expire on a timer. It stops immediately if you disconnect it or your AIRE administrator access is disabled.
              </div>

              {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">{error}</div>}

              <div className="flex flex-col-reverse gap-3 border-t border-slate-200 pt-6 sm:flex-row sm:items-center sm:justify-end">
                {cancelUrl && (
                  <a href={cancelUrl} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-slate-300 px-5 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2">
                    <Unplug className="h-4 w-4" aria-hidden="true" />
                    Cancel
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => void connect()}
                  disabled={connecting}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-cyan-700 px-6 py-2.5 text-sm font-semibold text-white shadow-[0_12px_28px_-16px_rgba(14,116,144,0.8)] transition-all duration-200 hover:-translate-y-0.5 hover:bg-cyan-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-60"
                >
                  {connecting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Link2 className="h-4 w-4" aria-hidden="true" />}
                  {connecting ? 'Connecting…' : 'Connect and return to Cornerstone'}
                  {!connecting && <ArrowRight className="h-4 w-4" aria-hidden="true" />}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
