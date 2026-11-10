import { AlertCircle, Link2Off, RotateCw } from 'lucide-react'
import type { MyPayError, StatusTone } from '../../lib/myPayApi'

const toneClasses: Record<StatusTone, string> = {
  success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  info: 'border-cyan-200 bg-cyan-50 text-cyan-800',
  neutral: 'border-slate-200 bg-slate-50 text-slate-700',
  danger: 'border-red-200 bg-red-50 text-red-800',
}

export function StatusBadge({ label, tone }: { label: string; tone: StatusTone }) {
  return (
    <span className={`inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${toneClasses[tone]}`}>
      {label}
    </span>
  )
}

export function MyPayErrorState({ error, onRetry, retrying }: { error: MyPayError; onRetry?: () => void; retrying?: boolean }) {
  const notLinked = error.code === 'payroll_not_linked'
  const disabled = error.code === 'my_pay_not_enabled'
  const Icon = notLinked ? Link2Off : AlertCircle
  const retryable = !notLinked && !disabled && error.code !== 'statement_not_found'
  return (
    <div role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-amber-950">
      <div className="flex items-start gap-3">
        <Icon className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" aria-hidden="true" />
        <div className="min-w-0">
          <p className="font-semibold">
            {notLinked ? 'Payroll not connected yet' : disabled ? 'My Pay is not available yet' : error.code === 'statement_not_found' ? 'Paycheck not found' : 'Pay history is temporarily unavailable'}
          </p>
          {/* The heading already says it's unavailable; keep only what to do next. */}
          <p className="mt-1 text-sm text-amber-900">{retryable ? 'Please try again in a few minutes. Your paper stub is still your record of each check.' : error.message}</p>
          {retryable && onRetry && (
            <button
              type="button"
              onClick={onRetry}
              disabled={retrying}
              className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-xl border border-amber-300 bg-white px-4 text-sm font-semibold text-amber-900 transition-colors hover:bg-amber-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700 disabled:opacity-60"
            >
              <RotateCw className={`h-4 w-4 ${retrying ? 'animate-spin motion-reduce:animate-none' : ''}`} aria-hidden="true" />
              {retrying ? 'Trying again…' : 'Try again'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function Bar({ className }: { className: string }) {
  return <div className={`animate-pulse rounded-md bg-slate-200 motion-reduce:animate-none ${className}`} />
}

export function StatementListSkeleton() {
  return (
    <div aria-hidden="true" className="space-y-3">
      {[0, 1, 2].map((row) => (
        <div key={row} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-2">
              <Bar className="h-5 w-32" />
              <Bar className="h-4 w-44" />
            </div>
            <Bar className="h-7 w-24" />
          </div>
          <Bar className="mt-4 h-4 w-56" />
        </div>
      ))}
    </div>
  )
}

export function StatementDetailSkeleton() {
  return (
    <div aria-hidden="true" className="space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <Bar className="h-4 w-20" />
        <Bar className="mt-3 h-10 w-44" />
        <Bar className="mt-4 h-4 w-60" />
        <Bar className="mt-5 h-11 w-40" />
      </div>
      {[0, 1].map((section) => (
        <div key={section} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <Bar className="h-5 w-28" />
          <div className="mt-4 space-y-3">
            <Bar className="h-4 w-full" />
            <Bar className="h-4 w-5/6" />
          </div>
        </div>
      ))}
    </div>
  )
}
