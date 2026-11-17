import { cx } from '../../lib/cx'

/** Whole labels keep their width; the containing row chooses wrapping or scrolling. */
export function chipClasses(selected: boolean) {
  return cx(
    'inline-flex min-h-11 max-w-full shrink-0 items-center justify-center gap-1.5 whitespace-normal [overflow-wrap:anywhere] text-balance text-center leading-tight py-2 pointer-fine:min-h-9 rounded-full border px-3.5 text-body-sm font-medium transition-colors duration-150',
    selected ? 'border-primary bg-primary text-white' : 'border-line-strong bg-surface text-ink-muted hover:bg-surface-muted hover:text-ink',
  )
}
