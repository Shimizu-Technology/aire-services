import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { cx } from '../../lib/cx'

export interface TabItem<T extends string> {
  value: T
  label: ReactNode
}

export interface TabsProps<T extends string> {
  /** Names the tablist: "Ethan Cruz". */
  label: string
  items: TabItem<T>[]
  /** The query parameter that holds the tab. Defaults to `tab`. */
  param?: string
  /** Shown when the URL names no tab or an unknown one. Defaults to the first. */
  defaultValue?: T
  /** Old keys that still arrive in links, mapped to today's: { hours: 'time', setup: 'access' }. */
  aliases?: Record<string, T>
  /** `push` adds a history entry per tab (Back returns to the last tab); `replace` doesn't. */
  history?: 'push' | 'replace'
  /** Renders the panel for the selected tab. */
  children: (value: T) => ReactNode
  className?: string
}

/**
 * Page tabs kept in the URL (`?tab=time`), so links, refresh and Back land on
 * the same tab. Old keys are rewritten in place. Other query parameters stay.
 * Arrow keys move between tabs; the panel follows.
 */
export function Tabs<T extends string>({ label, items, param = 'tab', defaultValue, aliases = {}, history = 'push', children, className }: TabsProps<T>) {
  const ids = useId()
  const [searchParams, setSearchParams] = useSearchParams()
  const refs = useRef<Array<HTMLButtonElement | null>>([])
  const raw = searchParams.get(param)
  const mapped = raw !== null && Object.prototype.hasOwnProperty.call(aliases, raw) ? aliases[raw] : raw
  const known = items.find(item => item.value === mapped)
  const selected = known?.value ?? defaultValue ?? items[0]?.value

  // Rewrite an old key (?tab=hours) to the new one without a history entry.
  const needsRewrite = raw !== null && known !== undefined && mapped !== raw
  useEffect(() => {
    if (!needsRewrite || !known) return
    setSearchParams(previous => {
      const next = new URLSearchParams(previous)
      next.set(param, known.value)
      return next
    }, { replace: true })
  }, [needsRewrite, known, param, setSearchParams])

  const select = (value: T) => {
    if (value === selected) return
    setSearchParams(previous => {
      const next = new URLSearchParams(previous)
      next.set(param, value)
      return next
    }, { replace: history === 'replace' })
  }

  const onKeyDown = (event: KeyboardEvent, index: number) => {
    const last = items.length - 1
    const next = event.key === 'ArrowRight' ? (index === last ? 0 : index + 1)
      : event.key === 'ArrowLeft' ? (index === 0 ? last : index - 1)
        : event.key === 'Home' ? 0
          : event.key === 'End' ? last
            : null
    if (next === null) return
    event.preventDefault()
    refs.current[next]?.focus()
    select(items[next].value)
  }

  if (selected === undefined) return null

  return (
    <div className={className}>
      <div
        role="tablist"
        aria-label={label}
        className="-mx-4 flex gap-1 overflow-x-auto border-b border-line px-4 [scrollbar-width:none] sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden"
      >
        {items.map((item, index) => {
          const isSelected = item.value === selected
          return (
            <button
              key={item.value}
              ref={(element) => { refs.current[index] = element }}
              id={`${ids}-tab-${item.value}`}
              type="button"
              role="tab"
              aria-selected={isSelected}
              aria-controls={`${ids}-panel`}
              tabIndex={isSelected ? 0 : -1}
              onClick={() => select(item.value)}
              onKeyDown={(event) => onKeyDown(event, index)}
              className={cx(
                '-mb-px inline-flex min-h-11 shrink-0 items-center border-b-2 px-3 text-body-sm font-semibold transition-colors duration-150',
                'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary',
                isSelected ? 'border-primary text-primary' : 'border-transparent text-ink-muted hover:text-ink',
              )}
            >
              {item.label}
            </button>
          )
        })}
      </div>
      <div id={`${ids}-panel`} role="tabpanel" aria-labelledby={`${ids}-tab-${selected}`} tabIndex={0} className="pt-4 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary">
        {children(selected)}
      </div>
    </div>
  )
}
