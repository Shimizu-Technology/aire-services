import type { ReactNode } from 'react'
import { Check, Info } from 'lucide-react'
import { cx } from '../../lib/cx'

export type ChecklistStatus = 'done' | 'todo' | 'info'

export interface ChecklistItemProps {
  status: ChecklistStatus
  /** The fact, in a sentence: "31 shifts waiting for approval". */
  children: ReactNode
  /** Secondary line: "27 ordinary · 4 need a look · 276.1h". */
  meta?: ReactNode
  /** One action for open items: "Review", "Fix". */
  action?: ReactNode
  className?: string
}

// Read before the item, so the state isn't carried by the icon alone.
const SPOKEN: Record<ChecklistStatus, string> = { done: 'Done:', todo: 'To do:', info: 'Note:' }

/** A line of a checklist (Before it locks, end-employment checks). Render inside a `<ul>`. */
export function ChecklistItem({ status, children, meta, action, className }: ChecklistItemProps) {
  return (
    <li data-status={status} className={cx('flex items-center gap-3 px-3.5 py-3', className)}>
      <span
        aria-hidden="true"
        className={cx(
          'inline-grid size-6 shrink-0 place-items-center rounded-full',
          status === 'done' && 'bg-emerald-50 text-emerald-600',
          status === 'todo' && 'border-[1.5px] border-amber-300 bg-amber-50',
          status === 'info' && 'bg-slate-100 text-ink-muted',
        )}
      >
        {status === 'done' && <Check className="size-3.5" strokeWidth={3} />}
        {status === 'info' && <Info className="size-3.5" strokeWidth={2.5} />}
      </span>
      <div className="min-w-0 flex-1 text-body-sm text-ink pointer-coarse:text-body">
        <p className="[overflow-wrap:anywhere]"><span className="sr-only">{SPOKEN[status]} </span>{children}</p>
        {meta && <p className="mt-0.5 text-body-sm text-ink-muted">{meta}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </li>
  )
}
