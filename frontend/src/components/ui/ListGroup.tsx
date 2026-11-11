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
/**
 * Put this attribute on a custom focusable widget inside a row (one that isn't
 * a link, button or form field) so it joins the row's tab stops.
 */
export const LIST_CONTROL_ATTRIBUTE = 'data-list-control'
// Every focusable thing in a row, including buttons in `trailing` such as a ⋯ Menu.
const CONTROL = `[${LIST_CONTROL_ATTRIBUTE}], a[href], button, input:not([type="hidden"]), select, textarea`
const TEXT_ENTRY = 'input:not([type="checkbox"]):not([type="radio"]), textarea, select, [contenteditable="true"]'

/**
 * A card of compact rows with one tab stop. Arrow keys or j/k move between
 * rows (including rows of open groups), Home and End jump to the ends, and Tab
 * reaches the focused row's own checkbox and buttons (any button or field in
 * the row, `trailing` included) before leaving the list. Space and Enter are
 * handled by each `ListRow`. When the focused row goes away (its group was
 * approved), focus moves to the next row, or the previous one at the end.
 */
export function ListGroup({ label, children, className }: ListGroupProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const activeRow = useRef<string | null>(null)
  // Rows as of the last sync, to find the neighbour of one that was removed.
  const knownRows = useRef<HTMLElement[]>([])
  const lastFocused = useRef<HTMLElement | null>(null)
  const focusInside = useRef(false)

  // Tab stops are set on the DOM, not through React state, so moving focus
  // doesn't re-render every row. When the active row goes away (a group was
  // approved, a filter changed) its neighbour takes over, or the first row.
  const syncTabStops = useCallback(() => {
    const root = rootRef.current
    if (!root) return
    const rows = Array.from(root.querySelectorAll<HTMLElement>(ROW))
    const lostFocus = focusInside.current && !lastFocused.current?.isConnected
      && (document.activeElement === document.body || document.activeElement === null)
    if (!rows.some(row => row.dataset.listRow === activeRow.current)) {
      const replacement = neighbourOf(knownRows.current, activeRow.current, root)
      activeRow.current = (replacement ?? rows[0])?.dataset.listRow ?? null
    }
    knownRows.current = rows
    for (const row of rows) {
      const tabIndex = row.dataset.listRow === activeRow.current ? 0 : -1
      row.tabIndex = tabIndex
      // Controls belong to the nearest row, not to a group header above it.
      for (const control of row.querySelectorAll<HTMLElement>(CONTROL)) {
        if (control.closest(ROW) === row) control.tabIndex = tabIndex
      }
    }
    // React doesn't move focus when it removes the focused element; the browser drops it on <body>.
    if (lostFocus) rows.find(row => row.dataset.listRow === activeRow.current)?.focus()
  }, [])

  useLayoutEffect(syncTabStops)

  // Rows of a group appear without this component re-rendering.
  useEffect(() => {
    const root = rootRef.current
    if (!root || typeof MutationObserver === 'undefined') return
    const observer = new MutationObserver(syncTabStops)
    observer.observe(root, { childList: true, subtree: true })
    // A click on the page outside the list means focus didn't just get lost.
    const onPointerDown = (event: PointerEvent) => {
      if (!root.contains(event.target as Node)) focusInside.current = false
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => {
      observer.disconnect()
      document.removeEventListener('pointerdown', onPointerDown, true)
    }
  }, [syncTabStops])

  const onFocus = (event: FocusEvent<HTMLDivElement>) => {
    focusInside.current = true
    lastFocused.current = event.target as HTMLElement
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
      // Only a move to somewhere else counts; removal blurs with no relatedTarget.
      onBlur={(event) => { if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) focusInside.current = false }}
      onKeyDown={onKeyDown}
      className={cx('divide-y divide-line overflow-hidden rounded-card border border-line bg-surface', className)}
    >
      {children}
    </div>
  )
}

/** The first row after `id` that's still in the list, else the last one before it. */
function neighbourOf(previous: HTMLElement[], id: string | null, root: HTMLElement) {
  const index = previous.findIndex(row => row.dataset.listRow === id)
  if (index < 0) return null
  const alive = (row: HTMLElement) => row.isConnected && root.contains(row)
  return previous.slice(index + 1).find(alive) ?? previous.slice(0, index).reverse().find(alive) ?? null
}
