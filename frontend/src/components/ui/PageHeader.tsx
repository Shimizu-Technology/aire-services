import type { ReactNode } from 'react'
import { cx } from '../../lib/cx'

export interface PageHeaderProps {
  /** The page's one H1. */
  title: ReactNode
  /** One short line. Leave out rather than repeat the title. */
  description?: ReactNode
  /** Page-level actions, primary last. They wrap under the title on phones. */
  actions?: ReactNode
  /** Small content under the description: a count, a period, a back link. */
  children?: ReactNode
  className?: string
}

export function PageHeader({ title, description, actions, children, className }: PageHeaderProps) {
  return (
    <header className={cx('flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6', className)}>
      <div className="min-w-0">
        <h1 className="text-heading font-semibold tracking-tight text-ink [overflow-wrap:anywhere]">{title}</h1>
        {description && <p className="mt-1 max-w-prose text-body-sm text-ink-muted">{description}</p>}
        {children && <div className="mt-2 text-body-sm text-ink-muted">{children}</div>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  )
}
