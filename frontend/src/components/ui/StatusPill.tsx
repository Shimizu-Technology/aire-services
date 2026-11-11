import type { ReactNode } from 'react'
import { cx } from '../../lib/cx'

/**
 * One vocabulary for status across the admin:
 * - waiting: needs someone's action (pending approval, awaiting review)
 * - approved: done and fine (approved, active, paid)
 * - needs-fix: something is wrong or blocked (denied, missed clock-out, error)
 * - info: neutral fact worth noticing (overtime, scheduled, manual entry)
 * - off: inactive or not applicable (terminated, disabled, draft)
 *
 * Write labels in sentence case ("Waiting on approval"), not capitals. The
 * label carries the meaning; colour only reinforces it.
 */
export type StatusTone = 'waiting' | 'approved' | 'needs-fix' | 'info' | 'off'

const tones: Record<StatusTone, { pill: string; dot: string }> = {
  waiting: { pill: 'border-amber-200 bg-amber-50 text-amber-900', dot: 'bg-amber-500' },
  approved: { pill: 'border-emerald-200 bg-emerald-50 text-emerald-800', dot: 'bg-emerald-600' },
  'needs-fix': { pill: 'border-red-200 bg-red-50 text-red-800', dot: 'bg-red-600' },
  info: { pill: 'border-sky-200 bg-sky-50 text-sky-900', dot: 'bg-sky-600' },
  off: { pill: 'border-slate-200 bg-slate-100 text-slate-700', dot: 'bg-slate-500' },
}

export interface StatusPillProps {
  tone: StatusTone
  children: ReactNode
  /** Optional icon instead of the dot. Decorative. */
  icon?: ReactNode
  className?: string
}

export function StatusPill({ tone, children, icon, className }: StatusPillProps) {
  const style = tones[tone]
  return (
    <span
      data-tone={tone}
      className={cx('inline-flex max-w-full items-center gap-1.5 rounded-full border px-2 py-0.5 text-caption font-medium', style.pill, className)}
    >
      {icon
        ? <span aria-hidden="true" className="inline-flex shrink-0 [&>svg]:size-3.5">{icon}</span>
        : <span aria-hidden="true" className={cx('size-1.5 shrink-0 rounded-full', style.dot)} />}
      <span className="truncate">{children}</span>
    </span>
  )
}
