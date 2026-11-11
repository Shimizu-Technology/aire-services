import { useEffect, useEffectEvent, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { cx } from '../../lib/cx'
import { useSelectionBarRegistration } from '../layouts/shellChrome'
import { Button } from './Button'

export interface SelectionBarProps {
  /** How many things are selected. At 0 the bar is gone and the tab bar is back. */
  count: number
  /** Singular and plural nouns for the count: ['shift', 'shifts']. */
  noun?: [string, string]
  /** Extra facts after the count: "2 people · 35.4h". */
  summary?: ReactNode
  /** The batch action, usually one primary Button: "Approve 4". */
  actions: ReactNode
  onClear: () => void
  clearLabel?: string
  /** Escape clears the selection unless focus is in a text field or a dialog took the key. */
  clearOnEscape?: boolean
  /** Names the region, e.g. "Selected shifts". */
  label?: string
  className?: string
}

const TEXT_ENTRY = 'input:not([type="checkbox"]):not([type="radio"]), textarea, select, [contenteditable="true"]'

/**
 * Batch actions for a selection. On phones it takes the tab bar's place at the
 * bottom of the screen (like iOS Photos), so the action stays under the thumb
 * and switching tabs can't drop the selection. On desktop it sticks to the
 * bottom of the content. Keep it mounted with `count` 0 so the live count is
 * announced from the first selection.
 */
export function SelectionBar({
  count,
  noun = ['item', 'items'],
  summary,
  actions,
  onClear,
  clearLabel = 'Clear',
  clearOnEscape = true,
  label = 'Selection',
  className,
}: SelectionBarProps) {
  const ids = useId()
  const active = count > 0
  const barRef = useRef<HTMLDivElement>(null)
  const lastOutsideFocus = useRef<HTMLElement | null>(null)
  const wasActive = useRef(active)
  // Silent until something has been selected, then "Selection cleared" at 0.
  const [everActive, setEverActive] = useState(active)
  if (active && !everActive) setEverActive(true)
  useSelectionBarRegistration(active)

  // Remember where focus was before it entered the bar (the row checkbox, say),
  // so clearing from the bar returns there instead of dropping it on <body>.
  useEffect(() => {
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target
      if (target instanceof HTMLElement && !barRef.current?.contains(target)) lastOutsideFocus.current = target
    }
    document.addEventListener('focusin', onFocusIn)
    return () => document.removeEventListener('focusin', onFocusIn)
  }, [])

  useLayoutEffect(() => {
    if (wasActive.current && !active && (document.activeElement === document.body || !document.activeElement)) {
      const back = lastOutsideFocus.current
      if (back?.isConnected) back.focus()
    }
    wasActive.current = active
  }, [active])

  const clear = useEffectEvent(onClear)
  useEffect(() => {
    if (!active || !clearOnEscape) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      const target = event.target as HTMLElement | null
      if (target?.closest?.(TEXT_ENTRY) || target?.closest?.('[role="dialog"], [role="alertdialog"], [role="menu"]')) return
      clear()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [active, clearOnEscape])

  const countText = `${count} ${count === 1 ? noun[0] : noun[1]}`

  return (
    <>
      {/* Lives outside the bar so it can announce "cleared" after the bar goes. */}
      <p id={`${ids}-count`} aria-live="polite" className="sr-only">
        {active ? `${countText} selected` : everActive ? 'Selection cleared' : ''}
      </p>
      {active && (
        <div
          ref={barRef}
          role="region"
          aria-label={label}
          aria-describedby={`${ids}-count`}
          className={cx(
            'z-(--z-tabbar) flex items-center gap-3 bg-surface pt-3 shadow-raised',
            // Phones: fixed where the tab bar was, clear of the home indicator and side insets.
            'fixed inset-x-0 bottom-0 pb-safe-3 pl-[max(1rem,env(safe-area-inset-left,0px))] pr-[max(1rem,env(safe-area-inset-right,0px))]',
            // Desktop: sticks to the bottom of the content column.
            'lg:sticky lg:inset-x-auto lg:mt-4 lg:rounded-card lg:border lg:border-line lg:px-5 lg:pb-3',
            className,
          )}
        >
          <p className="min-w-0 flex-1 text-body-sm text-ink-muted">
            <span className="text-body font-semibold text-ink">{countText}</span>
            {summary && <span className="block truncate sm:inline sm:before:mx-1.5 sm:before:content-['·']">{summary}</span>}
          </p>
          <Button variant="ghost" onClick={onClear} className="shrink-0">{clearLabel}</Button>
          <div className="flex shrink-0 items-center gap-2">{actions}</div>
        </div>
      )}
    </>
  )
}
