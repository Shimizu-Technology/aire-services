import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { cx } from '../../lib/cx'

export interface TabChip<T extends string> {
  value: T
  label: ReactNode
  /** Shown after the label, e.g. Time 31. */
  count?: number
}

export interface TabChipsProps<T extends string> {
  /** Names the tablist, e.g. "What's waiting". */
  label: string
  items: TabChip<T>[]
  value: T
  onChange: (value: T) => void
  /** The id of the panel these switch, for aria-controls. */
  controls?: string
  className?: string
}

/**
 * Kind chips with counts: Time 31 · Leave 5 · Pay stubs 1. A tablist that
 * scrolls sideways on narrow screens, with a fade on whichever edge has more.
 */
export function TabChips<T extends string>({ label, items, value, onChange, controls, className }: TabChipsProps<T>) {
  const scroller = useRef<HTMLDivElement>(null)
  const refs = useRef<Array<HTMLButtonElement | null>>([])
  const [edges, setEdges] = useState({ start: false, end: false })

  useEffect(() => {
    const element = scroller.current
    if (!element) return
    const measure = () => {
      const max = element.scrollWidth - element.clientWidth
      setEdges({ start: element.scrollLeft > 1, end: element.scrollLeft < max - 1 })
    }
    measure()
    element.addEventListener('scroll', measure, { passive: true })
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(element)
    return () => {
      element.removeEventListener('scroll', measure)
      observer?.disconnect()
    }
  }, [items.length])

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
    refs.current[next]?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
    onChange(items[next].value)
  }

  const fade = edges.start && edges.end
    ? '[mask-image:linear-gradient(to_right,transparent,black_1.5rem,black_calc(100%-1.5rem),transparent)]'
    : edges.start ? '[mask-image:linear-gradient(to_right,transparent,black_1.5rem)]'
      : edges.end ? '[mask-image:linear-gradient(to_right,black_calc(100%-1.5rem),transparent)]'
        : undefined

  return (
    <div
      ref={scroller}
      role="tablist"
      aria-label={label}
      // p-1 fits the 2px focus ring and its 2px offset, which overflow-x-auto would clip.
      className={cx('flex gap-2 overflow-x-auto overscroll-x-contain p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden', fade, className)}
    >
      {items.map((item, index) => {
        const selected = item.value === value
        return (
          <button
            key={item.value}
            ref={(element) => { refs.current[index] = element }}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={controls}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(item.value)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={cx(
              'inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-body-sm font-semibold transition-colors duration-150 pointer-fine:min-h-9',
              selected ? 'border-primary bg-primary text-white' : 'border-line-strong bg-surface text-ink-muted hover:bg-surface-muted hover:text-ink',
            )}
          >
            {item.label}
            {item.count !== undefined && <span className={cx('tabular-nums', selected ? 'text-white/85' : 'text-ink-subtle')}>{item.count}</span>}
          </button>
        )
      })}
    </div>
  )
}
