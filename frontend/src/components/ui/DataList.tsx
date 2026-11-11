import type { MouseEvent, ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { cx } from '../../lib/cx'

export interface DataListColumn<T> {
  id: string
  header: ReactNode
  cell: (row: T) => ReactNode
  /** The row's name. First column in the table, card heading on phones, and the keyboard target when rows open. */
  primary?: boolean
  align?: 'left' | 'right'
  /** Left out of phone cards when the card would get too long. */
  hideOnMobile?: boolean
  className?: string
}

export interface DataListProps<T> {
  rows: T[]
  columns: DataListColumn<T>[]
  getRowKey: (row: T) => string | number
  /** Names the table and the card list for screen readers, e.g. "Team members". */
  label: string
  /** Opens the row. The primary cell becomes a button; a click anywhere else on the row works too. */
  onRowClick?: (row: T) => void
  /** Accessible name for the open-row button, e.g. `Open ${row.name}`. Defaults to the primary cell text. */
  rowActionLabel?: (row: T) => string
  /** Shown instead of an empty table. Say what to do next. */
  empty?: ReactNode
  className?: string
}

const INTERACTIVE = 'a, button, input, select, textarea, label, summary, [role="button"], [role="switch"], [role="checkbox"]'

/**
 * A table on desktop (1024px and up) and stacked cards below that. The table
 * scrolls inside its own box with a sticky first column, so the page never
 * scrolls sideways.
 */
export function DataList<T>({ rows, columns, getRowKey, label, onRowClick, rowActionLabel, empty, className }: DataListProps<T>) {
  if (rows.length === 0) {
    return (
      <div className={cx('rounded-card border border-dashed border-line-strong bg-surface px-5 py-10 text-center text-body-sm text-ink-muted', className)}>
        {empty ?? 'Nothing to show yet.'}
      </div>
    )
  }

  const primary = columns.find(column => column.primary) ?? columns[0]
  const ordered = [primary, ...columns.filter(column => column !== primary)]
  const secondary = ordered.slice(1).filter(column => !column.hideOnMobile)

  const openRow = (row: T) => (event: MouseEvent) => {
    if (!onRowClick) return
    const target = event.target as HTMLElement
    if (target.closest(INTERACTIVE) && !target.closest('[data-row-open]')) return
    onRowClick(row)
  }

  const primaryContent = (row: T, card: boolean) => {
    const content = primary.cell(row)
    if (!onRowClick) return content
    return (
      <button
        type="button"
        data-row-open
        onClick={(event) => { event.stopPropagation(); onRowClick(row) }}
        aria-label={rowActionLabel?.(row)}
        className={cx(
          'inline-flex min-h-11 max-w-full items-center gap-1 text-left font-semibold text-ink hover:text-primary pointer-fine:min-h-0',
          card && 'w-full justify-between',
        )}
      >
        <span className="min-w-0 [overflow-wrap:anywhere]">{content}</span>
        {card && <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-ink-subtle" />}
      </button>
    )
  }

  return (
    <div className={className}>
      <div className="hidden overflow-x-auto rounded-card border border-line bg-surface lg:block">
        <table className="w-full border-collapse text-left text-body-sm">
          <caption className="sr-only">{label}</caption>
          <thead className="bg-surface-muted text-caption font-semibold text-ink-muted">
            <tr>
              {ordered.map((column, index) => (
                <th
                  key={column.id}
                  scope="col"
                  className={cx(
                    'whitespace-nowrap border-b border-line px-4 py-3',
                    index === 0 && 'sticky left-0 z-10 bg-surface-muted',
                    column.align === 'right' && 'text-right',
                    column.className,
                  )}
                >
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={getRowKey(row)}
                onClick={onRowClick ? openRow(row) : undefined}
                className={cx('group border-b border-line last:border-b-0', onRowClick && 'cursor-pointer hover:bg-surface-muted')}
              >
                {ordered.map((column, index) => index === 0 ? (
                  <th
                    key={column.id}
                    scope="row"
                    className={cx('sticky left-0 z-10 bg-surface px-4 py-3 text-left font-semibold text-ink', onRowClick && 'group-hover:bg-surface-muted', column.className)}
                  >
                    {primaryContent(row, false)}
                  </th>
                ) : (
                  <td key={column.id} className={cx('px-4 py-3 text-ink', column.align === 'right' && 'text-right tabular-nums', column.className)}>
                    {column.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul aria-label={label} className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface lg:hidden">
        {rows.map((row) => (
          <li key={getRowKey(row)} onClick={onRowClick ? openRow(row) : undefined} className="px-4 py-3">
            <div className="text-body text-ink">{primaryContent(row, true)}</div>
            {secondary.length > 0 && (
              <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-body-sm">
                {secondary.map((column) => (
                  <div key={column.id} className="contents">
                    <dt className="text-ink-subtle">{column.header}</dt>
                    <dd className={cx('min-w-0 text-ink [overflow-wrap:anywhere]', column.align === 'right' && 'tabular-nums')}>{column.cell(row)}</dd>
                  </div>
                ))}
              </dl>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
