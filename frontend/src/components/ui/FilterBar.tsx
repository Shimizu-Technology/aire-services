import { useId, useState, type ReactNode } from 'react'
import { Search, SlidersHorizontal } from 'lucide-react'
import { cx } from '../../lib/cx'
import { Button } from './Button'
import { Sheet } from './Sheet'

export interface FilterBarProps {
  search?: {
    value: string
    onChange: (value: string) => void
    label: string
    placeholder?: string
  }
  /** Up to about three inline filters, usually `FilterChip`s. */
  children?: ReactNode
  /** Everything else. Shown in a sheet behind a "Filters" button. */
  moreFilters?: ReactNode
  /** How many filters in the sheet are set. Shown as a count on the button. */
  activeFilterCount?: number
  /** Resets every filter. Shown when something is set. */
  onClear?: () => void
  /** e.g. "71 waiting". Read politely when it changes. */
  resultSummary?: ReactNode
  className?: string
}

export function FilterBar({ search, children, moreFilters, activeFilterCount = 0, onClear, resultSummary, className }: FilterBarProps) {
  const ids = useId()
  const [sheetOpen, setSheetOpen] = useState(false)
  const hasActive = activeFilterCount > 0 || Boolean(search?.value)

  return (
    <div role="search" className={cx('flex flex-col gap-3', className)}>
      <div className="flex flex-wrap items-center gap-2">
        {search && (
          <div className="relative min-w-0 flex-1 basis-56">
            <label htmlFor={`${ids}-search`} className="sr-only">{search.label}</label>
            <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-subtle" />
            <input
              id={`${ids}-search`}
              type="search"
              enterKeyHint="search"
              value={search.value}
              onChange={(event) => search.onChange(event.target.value)}
              placeholder={search.placeholder}
              className="block min-h-11 w-full rounded-control border border-line-strong bg-surface pl-9 pr-3 text-body text-ink placeholder:text-ink-subtle focus:border-primary pointer-fine:text-body-sm"
            />
          </div>
        )}
        {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
        {moreFilters && (
          <Button
            variant="secondary"
            icon={<SlidersHorizontal className="size-4" />}
            onClick={() => setSheetOpen(true)}
            aria-haspopup="dialog"
            aria-label={activeFilterCount > 0 ? `Filters, ${activeFilterCount} set` : undefined}
          >
            Filters
            {activeFilterCount > 0 && (
              <span aria-hidden="true" className="inline-flex min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-caption font-semibold text-white">
                {activeFilterCount}
              </span>
            )}
          </Button>
        )}
        {onClear && hasActive && (
          <Button variant="ghost" onClick={onClear}>Clear</Button>
        )}
      </div>
      {resultSummary && <p aria-live="polite" className="text-body-sm text-ink-muted">{resultSummary}</p>}
      {moreFilters && (
        <Sheet
          open={sheetOpen}
          onClose={() => setSheetOpen(false)}
          title="Filters"
          footer={(
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              {onClear && <Button variant="secondary" onClick={onClear} className="w-full sm:w-auto">Clear all</Button>}
              <Button onClick={() => setSheetOpen(false)} className="w-full sm:w-auto">Done</Button>
            </div>
          )}
        >
          <div className="space-y-4">{moreFilters}</div>
        </Sheet>
      )}
    </div>
  )
}

export interface FilterChipProps {
  selected: boolean
  onClick: () => void
  children: ReactNode
  /** Optional count shown after the label, e.g. 16. */
  count?: number
}

/** A toggle for a common filter. Announced as pressed or not pressed. */
export function FilterChip({ selected, onClick, children, count }: FilterChipProps) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cx(
        'inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3.5 text-body-sm font-medium transition-colors duration-150 pointer-fine:min-h-9',
        selected ? 'border-primary bg-primary text-white' : 'border-line-strong bg-surface text-ink hover:bg-surface-muted',
      )}
    >
      {children}
      {count !== undefined && <span className={cx('tabular-nums', selected ? 'text-white/85' : 'text-ink-subtle')}>{count}</span>}
    </button>
  )
}
