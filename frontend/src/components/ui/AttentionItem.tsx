import type { ReactNode } from 'react'
import { cx } from '../../lib/cx'

export type AttentionTone = 'warn' | 'bad' | 'info'

export interface AttentionItemProps {
  /** `bad` blocks payroll, `warn` needs someone soon, `info` is a request or reminder. */
  tone: AttentionTone
  /** Decorative icon in the tile. */
  icon: ReactNode
  /** One sentence with the subject in bold: <b>Caleb Perez</b> still clocked in. */
  children: ReactNode
  /** The secondary line: "Since Tue, Nov 10, 7:02 AM · 36.7h". */
  meta?: ReactNode
  /** One action, usually a Button or a Link with buttonClasses: "Fix clock-out". */
  action?: ReactNode
  className?: string
}

const TILES: Record<AttentionTone, string> = {
  warn: 'bg-amber-50 text-amber-700',
  bad: 'bg-danger-soft text-red-600',
  info: 'bg-slate-100 text-primary',
}

/**
 * One row of a "Needs attention" list (Today, banners). Render inside a
 * `<ul>`; the sentence carries the meaning, the tile colour only reinforces it.
 */
export function AttentionItem({ tone, icon, children, meta, action, className }: AttentionItemProps) {
  return (
    <li data-tone={tone} className={cx('grid grid-cols-[auto_minmax(0,1fr)] items-start gap-3 px-3.5 py-3 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center', className)}>
      <span aria-hidden="true" className={cx('inline-grid size-8 shrink-0 place-items-center rounded-control [&>svg]:size-[1.125rem]', TILES[tone])}>{icon}</span>
      <div className="min-w-0 flex-1 text-body-sm leading-snug text-ink pointer-coarse:text-body">
        <p className="[overflow-wrap:anywhere]">{children}</p>
        {meta && <p className="mt-0.5 text-body-sm text-ink-muted">{meta}</p>}
      </div>
      {action && <div className="col-span-2 grid grid-cols-1 sm:col-span-1 [&>a]:w-full [&>button]:w-full sm:[&>a]:w-auto sm:[&>button]:w-auto">{action}</div>}
    </li>
  )
}
