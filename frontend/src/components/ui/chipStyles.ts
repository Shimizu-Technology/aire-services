import { cx } from '../../lib/cx'

/** Whole labels keep their width; the containing row chooses wrapping or scrolling. */
export function chipClasses(selected: boolean) {
  return cx(
    'inline-flex h-11 min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-body-sm font-medium transition-colors duration-150',
    selected ? 'border-primary bg-primary text-white' : 'border-line-strong bg-surface text-ink-muted hover:bg-surface-muted hover:text-ink',
  )
}
