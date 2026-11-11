import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Info } from 'lucide-react'
import { cx } from '../../lib/cx'

export interface HelpTipProps {
  /** What the tip explains, e.g. "Early clock-in buffer". Used in the button's name and as the tip heading. */
  label: string
  /** Free-form explanation. Use the structured props below for settings. */
  children?: ReactNode
  /** Structured mode: what the setting or control does. */
  what?: ReactNode
  /** Structured mode: the value it starts with. */
  defaultValue?: ReactNode
  /** Structured mode: which roles can change it. */
  who?: ReactNode
  /** Structured mode: a concrete example. */
  example?: ReactNode
  className?: string
}

const VIEWPORT_MARGIN = 8
const GAP = 8

/**
 * A small (i) button that opens a short explanation. Opens on tap, click,
 * Enter or Space (not on hover), closes on Escape, an outside tap or moving
 * focus elsewhere, and is announced through a polite live region.
 */
export function HelpTip({ label, children, what, defaultValue, who, example, className }: HelpTipProps) {
  const ids = useId()
  const bubbleId = `${ids}-tip`
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const bubbleRef = useRef<HTMLDivElement>(null)

  const structured = [
    what !== undefined && { term: 'What it does', value: what },
    defaultValue !== undefined && { term: 'Default', value: defaultValue },
    who !== undefined && { term: 'Who can change it', value: who },
    example !== undefined && { term: 'Example', value: example },
  ].filter(Boolean) as Array<{ term: string; value: ReactNode }>

  const body = (
    <>
      {children && <div className="space-y-1.5">{children}</div>}
      {structured.length > 0 && (
        <dl className={cx('space-y-2', children ? 'mt-2' : undefined)}>
          {structured.map(item => (
            <div key={item.term}>
              <dt className="text-caption font-semibold text-ink-muted">{item.term}</dt>
              <dd className="text-body-sm text-ink">{item.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </>
  )

  // Position before paint, writing to the bubble directly so scrolling
  // doesn't re-render. Kept inside the viewport on narrow phones.
  useLayoutEffect(() => {
    if (!open) return
    const trigger = triggerRef.current
    const bubble = bubbleRef.current
    if (!trigger || !bubble) return
    const place = () => {
      const anchor = trigger.getBoundingClientRect()
      const viewportWidth = document.documentElement.clientWidth || window.innerWidth
      const viewportHeight = window.innerHeight
      const width = bubble.offsetWidth
      const height = bubble.offsetHeight
      const centre = anchor.left + anchor.width / 2
      const maxLeft = Math.max(VIEWPORT_MARGIN, viewportWidth - width - VIEWPORT_MARGIN)
      const left = Math.min(Math.max(centre - width / 2, VIEWPORT_MARGIN), maxLeft)
      const fitsBelow = anchor.bottom + GAP + height <= viewportHeight - VIEWPORT_MARGIN
      const fitsAbove = anchor.top - GAP - height >= VIEWPORT_MARGIN
      const above = !fitsBelow && fitsAbove
      const top = above ? anchor.top - GAP - height : anchor.bottom + GAP
      bubble.style.left = `${Math.round(left)}px`
      bubble.style.top = `${Math.round(top)}px`
      bubble.style.transformOrigin = `${Math.round(centre - left)}px ${above ? '100%' : '0'}`
      bubble.dataset.side = above ? 'top' : 'bottom'
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (triggerRef.current?.contains(target) || bubbleRef.current?.contains(target)) return
      setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      // Don't let Escape also close a dialog this tip sits in.
      event.stopPropagation()
      setOpen(false)
      triggerRef.current?.focus()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('keydown', onKeyDown, true)
    }
  }, [open])

  return (
    <span className={cx('relative inline-flex align-middle', className)}>
      <button
        ref={triggerRef}
        type="button"
        aria-label={`About ${label}`}
        aria-expanded={open}
        aria-controls={open ? bubbleId : undefined}
        onClick={() => setOpen(value => !value)}
        onBlur={(event) => {
          const next = event.relatedTarget as Node | null
          if (next && !bubbleRef.current?.contains(next)) setOpen(false)
        }}
        className={cx(
          'relative inline-flex size-6 items-center justify-center rounded-full text-ink-subtle transition-colors duration-150 hover:text-primary',
          // 44px hit area without changing the layout around it.
          "after:absolute after:-inset-2.5 after:content-['']",
          open && 'text-primary',
        )}
      >
        <Info aria-hidden="true" className="size-4" />
      </button>
      {/* Announces the tip when it opens. The visible bubble below is aria-hidden so it isn't read twice. */}
      <span role="status" className="sr-only">
        {open ? <>{label}. {body}</> : null}
      </span>
      {open && createPortal(
        <div
          ref={bubbleRef}
          id={bubbleId}
          aria-hidden="true"
          className={cx(
            'fixed left-0 top-0 z-[80] w-max max-w-[min(20rem,calc(100vw-1rem))] rounded-card border border-line bg-surface p-3 text-left shadow-lg',
            'transition-[opacity,scale] duration-150 ease-out-strong starting:scale-[0.97] starting:opacity-0 motion-reduce:starting:scale-100',
          )}
        >
          <p className="text-body-sm font-semibold text-ink">{label}</p>
          <div className="mt-1 text-body-sm text-ink-muted">{body}</div>
        </div>,
        document.body,
      )}
    </span>
  )
}
