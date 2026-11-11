import type { ReactNode } from 'react'
import { cx } from '../../lib/cx'

export interface EmptyStateProps {
  /** What's true: "All caught up." */
  title: ReactNode
  /** What was checked, in a sentence: "Nothing is waiting for approval in CFI." */
  description?: ReactNode
  /** One next step, e.g. a "See everyone" link or a Button. */
  action?: ReactNode
  /** Decorative icon above the title. */
  icon?: ReactNode
  className?: string
}

/** Nothing to show, said plainly, with at most one way forward. */
export function EmptyState({ title, description, action, icon, className }: EmptyStateProps) {
  return (
    <div className={cx('flex flex-col items-center rounded-card border border-dashed border-line-strong bg-surface px-5 py-10 text-center', className)}>
      {icon && <span aria-hidden="true" className="mb-3 inline-grid size-10 place-items-center rounded-full bg-slate-100 text-ink-muted [&>svg]:size-5">{icon}</span>}
      <p className="text-body font-semibold text-ink">{title}</p>
      {description && <p className="mt-1 max-w-prose text-body-sm text-ink-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
