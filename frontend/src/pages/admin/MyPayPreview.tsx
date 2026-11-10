import { useCallback, useDeferredValue, useEffect, useId, useMemo, useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, ChevronRight, Eye, Search, Users } from 'lucide-react'
import { useAuthContext } from '../../contexts/AuthContext'
import { MyPayErrorState } from '../../components/my-pay/MyPayParts'
import { MyPayError, myPayPreviewApi, type MyPayPreviewWorker } from '../../lib/myPayApi'
import { MY_PAY_PREVIEW_PATH, MyPayScopeContext, previewMyPayScope } from '../../lib/myPayScope'
import MyPay from './MyPay'
import MyPayStatement from './MyPayStatement'

// Read-only "preview as a worker" for the admins on the preview allowlist. The
// list and detail are the worker's own My Pay screens, given that worker's
// scope; this page adds only the picker and the banner.

const UNAVAILABLE = 'Pay history is temporarily unavailable. Please try again in a few minutes.'
const SEARCH_KEY = 'aire-my-pay-preview-search'

function asMyPayError(error: unknown): MyPayError {
  return error instanceof MyPayError ? error : new MyPayError(UNAVAILABLE, 'network')
}

function readSavedSearch(): string {
  try {
    return window.sessionStorage.getItem(SEARCH_KEY) || ''
  } catch {
    return ''
  }
}

function saveSearch(value: string) {
  try {
    if (value) window.sessionStorage.setItem(SEARCH_KEY, value)
    else window.sessionStorage.removeItem(SEARCH_KEY)
  } catch {
    // Private browsing can refuse storage; the search just isn't remembered.
  }
}

function normalized(value: string): string {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim()
}

function NotAvailable() {
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-bold tracking-tight text-slate-900">Preview My Pay</h1>
      <p className="mt-3 rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-600 shadow-sm">
        My Pay preview isn&apos;t available for your account.
      </p>
    </div>
  )
}

function WorkerRow({ worker }: { worker: MyPayPreviewWorker }) {
  return (
    <li>
      <Link
        to={`${MY_PAY_PREVIEW_PATH}/${worker.id}`}
        className="group flex min-h-14 items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-slate-50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-cyan-600 active:bg-slate-100 sm:px-5"
      >
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="break-words font-semibold text-slate-900">{worker.name}</span>
            {worker.role === 'admin' && <span className="text-xs font-medium text-slate-500">Admin</span>}
          </p>
          <p className={`mt-0.5 text-sm ${worker.sent_to_payroll ? 'text-emerald-800' : 'text-slate-500'}`}>
            {worker.sent_to_payroll ? 'Hours sent to payroll' : 'No hours sent to payroll yet'}
          </p>
        </div>
        <ChevronRight className="h-5 w-5 shrink-0 text-slate-400 transition-colors group-hover:text-cyan-700" aria-hidden="true" />
      </Link>
    </li>
  )
}

function WorkerPicker() {
  const searchId = useId()
  const [query, setQuery] = useState(readSavedSearch)
  const deferredQuery = useDeferredValue(query)
  const [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState<{ attempt: number; workers?: MyPayPreviewWorker[]; error?: MyPayError } | null>(null)
  const loading = result?.attempt !== attempt

  useEffect(() => {
    const controller = new AbortController()
    myPayPreviewApi.workers(controller.signal)
      .then((data) => setResult({ attempt, workers: data.workers }))
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setResult({ attempt, error: asMyPayError(error) })
      })
    return () => controller.abort()
  }, [attempt])

  const workers = useMemo(() => result?.workers ?? [], [result])
  const matches = useMemo(() => {
    const needle = normalized(deferredQuery)
    return needle ? workers.filter((worker) => normalized(worker.name).includes(needle)) : workers
  }, [workers, deferredQuery])

  const updateQuery = (value: string) => {
    setQuery(value)
    saveSearch(value)
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <Link to="/admin/users" className="inline-flex min-h-11 items-center gap-1.5 rounded-lg text-sm font-semibold text-cyan-700 hover:text-cyan-900 focus-visible:outline-2 focus-visible:outline-cyan-600">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Team
        </Link>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">Preview My Pay</h1>
        <p className="mt-1 text-sm text-slate-600">
          See exactly what a worker sees in My Pay. Preview is read-only, and every paycheck you open is logged.
        </p>
      </div>

      <div>
        <label htmlFor={searchId} className="text-sm font-medium text-slate-700">Find a worker</label>
        <div className="relative mt-1.5">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
          <input
            id={searchId}
            type="search"
            value={query}
            onChange={(event) => updateQuery(event.target.value)}
            placeholder="Search by name"
            autoComplete="off"
            className="block min-h-11 w-full rounded-xl border border-slate-300 bg-white py-2 pr-3 pl-9 text-base text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-cyan-600 focus:outline-2 focus:outline-offset-0 focus:outline-cyan-600/30"
          />
        </div>
      </div>

      <div aria-live="polite" aria-busy={loading}>
        {loading && (
          <div aria-hidden="true" className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white shadow-sm">
            {[0, 1, 2, 3].map((row) => (
              <div key={row} className="space-y-2 px-4 py-4 sm:px-5">
                <div className="h-4 w-40 animate-pulse rounded-md bg-slate-200 motion-reduce:animate-none" />
                <div className="h-3.5 w-32 animate-pulse rounded-md bg-slate-200 motion-reduce:animate-none" />
              </div>
            ))}
          </div>
        )}
        {loading && <span className="sr-only">Loading workers…</span>}
        {!loading && result?.error && <MyPayErrorState error={result.error} onRetry={() => setAttempt((value) => value + 1)} />}
        {!loading && result?.workers && (
          <>
            <p className="mb-2 text-sm text-slate-500">
              {deferredQuery.trim() ? `${matches.length} of ${workers.length} ${workers.length === 1 ? 'person' : 'people'}` : `${workers.length} active ${workers.length === 1 ? 'person' : 'people'}`}
            </p>
            {matches.length > 0 ? (
              <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                {matches.map((worker) => <WorkerRow key={worker.id} worker={worker} />)}
              </ul>
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-5 py-8 text-center">
                <Users className="mx-auto h-7 w-7 text-slate-400" aria-hidden="true" />
                <p className="mt-2 font-semibold text-slate-900">{workers.length ? 'No one matches that name' : 'No active team members'}</p>
                {workers.length > 0 && (
                  <button type="button" onClick={() => updateQuery('')} className="mt-2 inline-flex min-h-11 items-center rounded-xl px-3 text-sm font-semibold text-cyan-700 underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-cyan-600">
                    Clear search
                  </button>
                )}
              </div>
            )}
            <p className="mt-3 text-xs text-slate-500">
              AIRE can&apos;t see payroll&apos;s worker list, so a connection is confirmed when you open someone. People payroll doesn&apos;t know yet see the same &ldquo;not connected&rdquo; message.
            </p>
          </>
        )}
      </div>
    </div>
  )
}

function PreviewBanner({ name }: { name: string | null }) {
  return (
    <div
      role="region"
      aria-label="Preview mode"
      className="sticky top-2 z-20 mx-auto mb-5 flex max-w-3xl flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-2xl bg-primary px-4 py-2.5 text-white shadow-md"
    >
      <p className="flex min-w-0 items-center gap-2 text-sm">
        <Eye className="h-4 w-4 shrink-0 text-cyan-200" aria-hidden="true" />
        <span className="min-w-0 break-words">
          Previewing as <strong className="font-semibold">{name ?? '…'}</strong>
          <span className="text-cyan-100"> · read-only</span>
        </span>
      </p>
      <Link
        to={MY_PAY_PREVIEW_PATH}
        className="-mx-1 inline-flex min-h-11 items-center gap-1 rounded-lg px-1 text-sm font-semibold text-white underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-white"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back to workers
      </Link>
    </div>
  )
}

function WorkerPreview({ userId, children }: { userId: string; children: ReactNode }) {
  const [attempt, setAttempt] = useState(0)
  const requestKey = `${userId}:${attempt}`
  const [result, setResult] = useState<{ key: string; worker?: MyPayPreviewWorker; error?: MyPayError } | null>(null)
  const current = result?.key === requestKey ? result : null
  const scope = useMemo(() => previewMyPayScope(userId), [userId])
  const retry = useCallback(() => setAttempt((value) => value + 1), [])

  useEffect(() => {
    const controller = new AbortController()
    myPayPreviewApi.worker(userId, controller.signal)
      .then((data) => setResult({ key: requestKey, worker: data.worker }))
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setResult({ key: requestKey, error: asMyPayError(error) })
      })
    return () => controller.abort()
  }, [userId, requestKey])

  if (current?.error) {
    const missing = current.error.code === 'worker_not_found' || current.error.code === 'statement_not_found'
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <PreviewBanner name="—" />
        {missing ? (
          <div role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-amber-950">
            <p className="font-semibold">Worker not found</p>
            <p className="mt-1 text-sm text-amber-900">This person isn&apos;t an active AIRE team member. Pick someone from the list.</p>
          </div>
        ) : (
          <MyPayErrorState error={current.error} onRetry={retry} />
        )}
      </div>
    )
  }

  return (
    <>
      <PreviewBanner name={current?.worker?.name ?? null} />
      {current?.worker ? (
        <MyPayScopeContext.Provider value={scope}>{children}</MyPayScopeContext.Provider>
      ) : (
        <span className="sr-only" role="status">Loading worker…</span>
      )}
    </>
  )
}

export default function MyPayPreview({ view }: { view: 'picker' | 'list' | 'statement' }) {
  const { userId = '' } = useParams()
  const { currentUser, isClerkEnabled } = useAuthContext()
  const allowed = Boolean(currentUser?.my_pay_preview_enabled)

  if (!allowed) return currentUser || !isClerkEnabled ? <NotAvailable /> : null
  if (view === 'picker') return <WorkerPicker />

  return (
    <WorkerPreview key={userId} userId={userId}>
      {view === 'list' ? <MyPay /> : <MyPayStatement />}
    </WorkerPreview>
  )
}
