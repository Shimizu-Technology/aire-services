import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { Ellipsis } from 'lucide-react'
import { cx } from '../../lib/cx'
import { useEscapeLayer } from '../../lib/useDialogFocus'
import { useMediaQuery } from '../../lib/useMediaQuery'
import { IconButton } from './Button'
import type { ButtonVariant } from './buttonStyles'
import { Sheet } from './Sheet'

export interface MenuItem {
  id: string
  /** Name the outcome: "Send stub", "Reset kiosk PIN". */
  label: ReactNode
  onSelect: () => void
  /** Decorative icon before the label. */
  icon?: ReactNode
  /** `danger` for destructive actions; they should still confirm. */
  tone?: 'default' | 'danger'
  disabled?: boolean
}

export interface MenuProps {
  /** The trigger's accessible name, e.g. "More actions for Caleb Perez". */
  label: string
  items: MenuItem[]
  /** Heading of the phone sheet. Defaults to `label`. */
  title?: ReactNode
  /** The trigger icon. Defaults to ⋯. */
  icon?: ReactNode
  triggerVariant?: ButtonVariant
  className?: string
}

// Tailwind's lg: the sidebar and pointer layout start here.
export const MENU_DESKTOP_QUERY = '(min-width: 1024px)'
const GAP = 4
const MARGIN = 8

function isDesktop() {
  if (typeof window.matchMedia === 'function') return window.matchMedia(MENU_DESKTOP_QUERY).matches
  return window.innerWidth >= 1024
}

/**
 * Overflow (⋯) actions. A popover menu from 1024px, and a bottom sheet with
 * large rows on phones and tablets.
 */
export function Menu({ label, items, title, icon, triggerVariant = 'ghost', className }: MenuProps) {
  const [open, setOpen] = useState<null | 'menu' | 'sheet'>(null)
  const desktop = useMediaQuery(MENU_DESKTOP_QUERY)
  const triggerRef = useRef<HTMLButtonElement>(null)

  // Crossing the breakpoint while open would leave the wrong kind of menu up.
  if ((open === 'menu' && !desktop && typeof window.matchMedia === 'function') || (open === 'sheet' && desktop)) setOpen(null)

  const close = (returnFocus = true) => {
    setOpen(null)
    if (returnFocus) triggerRef.current?.focus()
  }

  const select = (item: MenuItem) => {
    if (item.disabled) return
    close()
    item.onSelect()
  }

  return (
    <>
      <IconButton
        ref={triggerRef}
        label={label}
        icon={icon ?? <Ellipsis className="size-5" />}
        variant={triggerVariant}
        aria-haspopup={desktop ? 'menu' : 'dialog'}
        aria-expanded={open !== null}
        onClick={() => setOpen(current => (current ? null : isDesktop() ? 'menu' : 'sheet'))}
        className={className}
      />
      {open === 'menu' && <MenuPopover label={label} items={items} triggerRef={triggerRef} onClose={close} onSelect={select} />}
      <Sheet open={open === 'sheet'} onClose={() => setOpen(null)} title={title ?? label}>
        <ul className="-mx-2 space-y-1">
          {items.map(item => (
            <li key={item.id}>
              <button
                type="button"
                disabled={item.disabled}
                onClick={() => { setOpen(null); item.onSelect() }}
                className={cx(
                  'flex min-h-12 w-full items-center gap-3 rounded-control px-3 text-left text-body font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50',
                  item.tone === 'danger' ? 'text-danger hover:bg-danger-soft' : 'text-ink hover:bg-surface-muted',
                )}
              >
                {item.icon && <span aria-hidden="true" className="inline-flex shrink-0 [&>svg]:size-5">{item.icon}</span>}
                <span className="min-w-0 flex-1">{item.label}</span>
              </button>
            </li>
          ))}
        </ul>
      </Sheet>
    </>
  )
}

function MenuPopover({ label, items, triggerRef, onClose, onSelect }: {
  label: string
  items: MenuItem[]
  triggerRef: RefObject<HTMLButtonElement | null>
  onClose: (returnFocus?: boolean) => void
  onSelect: (item: MenuItem) => void
}) {
  const ids = useId()
  const menuRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([])
  const enabled = items.map((item, index) => (item.disabled ? -1 : index)).filter(index => index >= 0)
  // Escape closes this menu, not a Sheet or dialog it was opened from.
  useEscapeLayer(true, menuRef, () => onClose())

  // Right-aligned under the trigger; flips above when there's no room below.
  useLayoutEffect(() => {
    const trigger = triggerRef.current
    const menu = menuRef.current
    if (!trigger || !menu) return
    const place = () => {
      const anchor = trigger.getBoundingClientRect()
      const width = menu.offsetWidth
      const height = menu.offsetHeight
      const viewportWidth = document.documentElement.clientWidth || window.innerWidth
      const left = Math.min(Math.max(anchor.right - width, MARGIN), Math.max(MARGIN, viewportWidth - width - MARGIN))
      const above = anchor.bottom + GAP + height > window.innerHeight - MARGIN && anchor.top - GAP - height >= MARGIN
      menu.style.left = `${Math.round(left)}px`
      menu.style.top = `${Math.round(above ? anchor.top - GAP - height : anchor.bottom + GAP)}px`
      menu.style.transformOrigin = `${Math.round(anchor.right - left - anchor.width / 2)}px ${above ? '100%' : '0'}`
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [triggerRef])

  useEffect(() => {
    itemRefs.current[enabled[0]]?.focus()
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return
      onClose(false)
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => document.removeEventListener('pointerdown', onPointerDown, true)
    // Focus the first item once, on open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onKeyDown = (event: KeyboardEvent) => {
    const position = enabled.indexOf(itemRefs.current.findIndex(element => element === document.activeElement))
    const move = (to: number) => { event.preventDefault(); itemRefs.current[enabled[to]]?.focus() }
    if (event.key === 'ArrowDown') move(position < enabled.length - 1 ? position + 1 : 0)
    else if (event.key === 'ArrowUp') move(position > 0 ? position - 1 : enabled.length - 1)
    else if (event.key === 'Home') move(0)
    else if (event.key === 'End') move(enabled.length - 1)
    else if (event.key === 'Tab') onClose(false)
  }

  return createPortal(
    <div
      ref={menuRef}
      id={`${ids}-menu`}
      role="menu"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cx(
        'fixed left-0 top-0 z-(--z-popover) min-w-48 max-w-[min(20rem,calc(100vw-1rem))] rounded-card border border-line bg-surface p-1 shadow-lg',
        'transition-[opacity,scale] duration-150 ease-out-strong starting:scale-[0.97] starting:opacity-0 motion-reduce:starting:scale-100',
      )}
    >
      {items.map((item, index) => (
        <button
          key={item.id}
          ref={(element) => { itemRefs.current[index] = element }}
          type="button"
          role="menuitem"
          tabIndex={-1}
          aria-disabled={item.disabled || undefined}
          onClick={() => onSelect(item)}
          className={cx(
            'flex min-h-11 w-full items-center gap-2.5 rounded-control px-3 text-left text-body-sm font-medium transition-colors pointer-fine:min-h-9 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary duration-150 aria-disabled:cursor-not-allowed aria-disabled:opacity-50',
            item.tone === 'danger' ? 'text-danger hover:bg-danger-soft focus:bg-danger-soft' : 'text-ink hover:bg-surface-muted focus:bg-surface-muted',
          )}
        >
          {item.icon && <span aria-hidden="true" className="inline-flex shrink-0 [&>svg]:size-4">{item.icon}</span>}
          <span className="min-w-0 flex-1">{item.label}</span>
        </button>
      ))}
    </div>,
    document.body,
  )
}
