import { useCallback, useEffect, useLayoutEffect, useRef, type FocusEvent, type KeyboardEvent, type ReactNode } from 'react'
import { cx } from '../../lib/cx'

export interface ListGroupProps {
  /** Names the list for screen readers, e.g. "Ordinary shifts by person". */
  label: string
  /** `ListRow`s. A row with children is a group header with its own rows. */
  children: ReactNode
  className?: string
}

const ROW = '[data-list-row]'
const CONTROL = '[data-list-control]'
const TEXT_ENTRY = 'input:not([type="checkbox"]):not([type="radio"]), textarea, select, [contenteditable="true"]'

/**
 * A card of compact rows with one tab stop. Arrow keys or j/k move between
 * rows (including rows of open groups), Home and End jump to the ends, and Tab
 * reaches the focused row's own checkbox and buttons before leaving the list.
 * Space and Enter are handled by each `ListRow`.
 */
export function ListGroup({ label, children, className }: ListGroupProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const activeRow = useRef<string | null>(null)

  // Tab stops are set on the DOM, not through React state, so moving focus
  // doesn't re-render every row. When the active row goes away (a group was
  // approved, a filter changed) the first row takes over.
  const syncTabStops = useCallback(() => {
    const root = rootRef.current
    if (!root) return
    const rows = Array.from(root.querySelectorAll<HTMLElement>(ROW))
    if (!rows.some(row => row.dataset.listRow === activeRow.current)) activeRow.current = rows[0]?.dataset.listRow ?? null
    for (const row of rows) {
      const tabIndex = row.dataset.listRow === activeRow.current ? 0 : -1
      row.tabIndex = tabIndex
      // Controls belong to the nearest row, not to a group header above it.
      for (const control of row.querySelectorAll<HTMLElement>(CONTROL)) {
        if (control.closest(ROW) === row) control.tabIndex = tabIndex
      }
    }
  }, [])

  useLayoutEffect(syncTabStops)

  // Rows of a group appear without this component re-rendering.
  useEffect(() => {
    const root = rootRef.current
    if (!root || typeof MutationObserver === 'undefined') return
    const observer = new MutationObserver(syncTabStops)
    observer.observe(root, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [syncTabStops])

  const onFocus = (event: FocusEvent<HTMLDivElement>) => {
    const row = (event.target as HTMLElement).closest<HTMLElement>(ROW)
    if (!row || row.dataset.listRow === activeRow.current) return
    activeRow.current = row.dataset.listRow ?? null
    syncTabStops()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return
    const target = event.target as HTMLElement
    if (target.closest(TEXT_ENTRY)) return
    const current = target.closest<HTMLElement>(ROW)
    if (!current || !rootRef.current) return
    const rows = Array.from(rootRef.current.querySelectorAll<HTMLElement>(ROW))
    const index = rows.indexOf(current)
    const key = event.key
    const next = key === 'ArrowDown' || key === 'j' ? Math.min(index + 1, rows.length - 1)
      : key === 'ArrowUp' || key === 'k' ? Math.max(index - 1, 0)
        : key === 'Home' ? 0
          : key === 'End' ? rows.length - 1
            : null
    if (next === null) return
    event.preventDefault()
    rows[next].focus()
  }

  return (
    <div
      ref={rootRef}
      role="list"
      aria-label={label}
      onFocus={onFocus}
      onKeyDown={onKeyDown}
      className={cx('divide-y divide-line overflow-hidden rounded-card border border-line bg-surface', className)}
    >
      {children}
    </div>
  )
}
