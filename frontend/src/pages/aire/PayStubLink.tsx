import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertCircle, Clock3, Download, FileText, Files, LockKeyhole, RotateCw } from 'lucide-react'
import { formatPayDate, formatPeriod } from '../../lib/myPayApi'
import { PayStubError, payStubLinkApi, saveBlob, type PayStubLinkSummary } from '../../lib/payStubsApi'
import { PAY_STUB_TOKEN_EVENT, readPayStubToken, stashPayStubToken } from '../../lib/payStubLinkToken'

// The page behind an emailed pay stub link. No sign-in: the token in the URL
// fragment is the credential, and the fragment never reaches a server. At
// startup main.tsx moves it into this tab's sessionStorage and cleans the URL
// (see payStubLinkToken.ts), so the page reads it from there. The page shows
// the employer, the worker's first name and pay dates only.

type LoadState =
  | { status: 'loading' }
  | { status: 'missing' }
  | { status: 'error'; error: PayStubError }
  | { status: 'ready'; summary: PayStubLinkSummary }

const UNAVAILABLE_TITLES: Record<string, string> = {
  expired: 'This link has expired',
  revoked: 'This link was turned off',
  used_up: 'This link has been used up',
  failed: "This link isn't active",
}

function expiresLabel(iso: string) {
  return new Date(iso).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Pacific/Guam' })
}

function useNoReferrer() {
  useEffect(() => {
    const tags = [['referrer', 'no-referrer'], ['robots', 'noindex, nofollow']].map(([name, content]) => {
      const tag = document.createElement('meta')
      tag.name = name
      tag.content = content
      document.head.appendChild(tag)
      return tag
    })
    const title = document.title
    document.title = 'Your pay stubs · AIRE Services Guam'
    return () => {
      tags.forEach((tag) => tag.remove())
      document.title = title
    }
  }, [])
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-slate-50 text-slate-900 [-webkit-tap-highlight-color:transparent]">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-xl items-center gap-3 px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
          <img src="/assets/aire/logo.png" alt="AIRE Services Guam" className="h-9 w-auto object-contain" />
        </div>
      </header>
      <main className="mx-auto max-w-xl px-4 py-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:py-10">{children}</main>
    </div>
  )
}

function Notice({ icon: Icon, title, children, action }: { icon: typeof AlertCircle; title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section role="alert" className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <Icon className="h-7 w-7 text-primary" aria-hidden="true" />
      <h1 className="mt-3 text-xl font-semibold tracking-tight text-slate-950">{title}</h1>
      <div className="mt-2 text-base leading-relaxed text-slate-600">{children}</div>
      {action}
    </section>
  )
}

const buttonBase = 'inline-flex min-h-12 items-center justify-center gap-2 rounded-xl px-4 text-base font-semibold select-none touch-manipulation transition-[background-color,transform] duration-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary active:scale-[0.98] disabled:opacity-60 motion-reduce:transition-none'

export default function PayStubLink() {
  useNoReferrer()
  const [token, setToken] = useState(() => {
    // Normally already done at startup; this covers rendering the page directly.
    stashPayStubToken()
    return readPayStubToken()
  })
  const tokenRef = useRef(token)
  const [state, setState] = useState<LoadState>(() => (token ? { status: 'loading' } : { status: 'missing' }))

  const [attempt, setAttempt] = useState(0)
  const [busy, setBusy] = useState<number | 'all' | null>(null)
  const [downloadError, setDownloadError] = useState<string | null>(null)

  // Opening another emailed link in this tab changes only the fragment; the
  // startup guard stashes the new token, cleans the URL and tells us.
  useEffect(() => {
    const onNewToken = () => {
      const next = readPayStubToken()
      if (next === tokenRef.current) return
      tokenRef.current = next
      setToken(next)
      setDownloadError(null)
      setState(next ? { status: 'loading' } : { status: 'missing' })
    }
    const onHashChange = () => {
      if (stashPayStubToken()) onNewToken()
    }
    window.addEventListener(PAY_STUB_TOKEN_EVENT, onNewToken)
    window.addEventListener('hashchange', onHashChange)
    return () => {
      window.removeEventListener(PAY_STUB_TOKEN_EVENT, onNewToken)
      window.removeEventListener('hashchange', onHashChange)
    }
  }, [])

  useEffect(() => {
    if (!token) return
    const controller = new AbortController()
    payStubLinkApi.lookup(token, controller.signal)
      .then((summary) => setState({ status: 'ready', summary }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setState({ status: 'error', error: error instanceof PayStubError ? error : new PayStubError('Something went wrong. Please try again.', 'unavailable') })
      })
    return () => controller.abort()
  }, [token, attempt])

  const retry = useCallback(() => {
    setState({ status: 'loading' })
    setAttempt((value) => value + 1)
  }, [])

  const download = async (target: number | 'all') => {
    if (!token) return
    setBusy(target)
    setDownloadError(null)
    try {
      const { blob, filename } = target === 'all' ? await payStubLinkApi.downloadAll(token) : await payStubLinkApi.download(token, target)
      saveBlob(blob, filename)
      // Refresh the downloads-left counts (and the page state if that was the last one).
      setState({ status: 'ready', summary: await payStubLinkApi.lookup(token) })
    } catch (error) {
      setDownloadError(error instanceof PayStubError ? error.message : 'The download failed. Please try again.')
      if (error instanceof PayStubError && error.status === 410) {
        payStubLinkApi.lookup(token).then((summary) => setState({ status: 'ready', summary })).catch(() => undefined)
      }
    } finally {
      setBusy(null)
    }
  }

  if (state.status === 'missing') {
    return (
      <Shell>
        <Notice icon={AlertCircle} title="This link isn't complete">
          Open the link straight from your AIRE email. If you copied it, make sure you copied the whole link.
        </Notice>
      </Shell>
    )
  }

  if (state.status === 'loading') {
    return (
      <Shell>
        <div aria-busy="true" className="space-y-3">
          <span className="sr-only">Loading your pay stubs…</span>
          <div className="h-7 w-40 animate-pulse rounded-md bg-slate-200 motion-reduce:animate-none" />
          <div className="h-24 animate-pulse rounded-2xl bg-slate-200 motion-reduce:animate-none" />
          <div className="h-24 animate-pulse rounded-2xl bg-slate-200 motion-reduce:animate-none" />
        </div>
      </Shell>
    )
  }

  if (state.status === 'error') {
    const retryable = state.error.code === 'network' || (state.error.status ?? 500) >= 500 || state.error.status === 429
    return (
      <Shell>
        <Notice
          icon={AlertCircle}
          title={state.error.code === 'link_not_found' ? "This link isn't valid" : "We couldn't open your pay stubs"}
          action={retryable ? (
            <button type="button" onClick={retry} className={`${buttonBase} mt-4 border border-slate-300 bg-white text-slate-900 hover:bg-slate-50`}>
              <RotateCw className="h-4 w-4" aria-hidden="true" />
              Try again
            </button>
          ) : undefined}
        >
          {state.error.message}
        </Notice>
      </Shell>
    )
  }

  const { summary } = state
  if (summary.state !== 'active') {
    return (
      <Shell>
        <Notice icon={summary.state === 'expired' ? Clock3 : LockKeyhole} title={UNAVAILABLE_TITLES[summary.state] ?? "This link isn't active"}>
          Ask the office to send you a new link. For your security, pay stub links work for a limited time and a limited number of downloads.
        </Notice>
      </Shell>
    )
  }

  const documents = summary.documents
  const several = documents.length > 1
  const anyLeft = documents.some((document) => document.downloads_left > 0)

  return (
    <Shell>
      <p className="text-sm font-semibold text-primary">{summary.employer}</p>
      <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-950">Hi {summary.first_name}</h1>
      <p className="mt-2 text-base leading-relaxed text-slate-600">
        {several ? `Your ${documents.length} pay stubs are ready to download.` : 'Your pay stub is ready to download.'}
      </p>

      {several && anyLeft && (
        <button type="button" onClick={() => download('all')} disabled={busy !== null} aria-busy={busy === 'all'} className={`${buttonBase} mt-5 w-full bg-primary text-white hover:bg-primary-light`}>
          <Files className="h-5 w-5" aria-hidden="true" />
          {busy === 'all' ? 'Preparing one PDF…' : `Download all ${documents.length} as one PDF`}
        </button>
      )}

      {downloadError && <p role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{downloadError}</p>}

      <ul className="mt-5 space-y-3" aria-label="Pay stubs">
        {documents.map((document) => {
          const payDate = formatPayDate(document.pay_date, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
          const left = document.downloads_left
          return (
            <li key={document.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-start gap-3">
                <FileText className="mt-0.5 h-5 w-5 shrink-0 text-slate-400" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-slate-950">Pay date {payDate}</p>
                  {document.period_start && document.period_end && (
                    <p className="mt-0.5 text-sm text-slate-600">Pay period {formatPeriod(document.period_start, document.period_end)}</p>
                  )}
                  <p className="mt-1 text-sm text-slate-500">{left > 0 ? `${left} ${left === 1 ? 'download' : 'downloads'} left` : 'No downloads left'}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => download(document.id)}
                disabled={busy !== null || left === 0}
                aria-busy={busy === document.id}
                aria-label={`Download pay stub for ${payDate}`}
                className={`${buttonBase} mt-3 w-full ${several ? 'border border-slate-300 bg-white text-slate-900 hover:bg-slate-50' : 'bg-primary text-white hover:bg-primary-light'}`}
              >
                <Download className="h-4 w-4" aria-hidden="true" />
                {busy === document.id ? 'Preparing PDF…' : 'Download PDF'}
              </button>
            </li>
          )
        })}
      </ul>

      <p className="mt-6 text-sm leading-relaxed text-slate-600">
        This link works until {expiresLabel(summary.expires_at)} (Guam time). Each stub can be downloaded {summary.downloads_per_document} times.
        Please don&apos;t share this page; anyone with the link can download these stubs until it expires.
      </p>
    </Shell>
  )
}
