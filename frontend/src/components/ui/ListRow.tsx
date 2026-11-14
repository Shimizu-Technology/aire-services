import { useId, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { cx } from '../../lib/cx'
import { Button } from './Button'
import type { ButtonVariant } from './buttonStyles'
import { Checkbox, type CheckedState } from './Checkbox'

export interface ListRowAction {
  label: ReactNode
  onClick: () => void
  variant?: ButtonVariant
  loading?: boolean
  disabled?: boolean
  /** Needed when the label alone is ambiguous in a list: "Approve 2 shifts for Marcus Quinata". */
  ariaLabel?: string
  /** Why it's disabled, e.g. "Reconnect to approve". */
  title?: string
}

export interface ListRowProps {
  title: ReactNode
  /** One secondary line: "2 shifts · Nov 10–11". */
  meta?: ReactNode
  /** Allow important secondary facts to wrap instead of being ellipsized. */
  metaWrap?: boolean
  /** Avatar or icon tile. */
  leading?: ReactNode
  /**
   * Content on the right: hours, a pill, reason chips, or a ⋯ `Menu`. Put the
   * row's main button in `action`. Buttons and fields here join the row's tab
   * stops automatically; give any other focusable widget LIST_CONTROL_ATTRIBUTE.
   */
  trailing?: ReactNode
  checkbox?: { checked: CheckedState; onChange: (checked: boolean) => void; label: string; disabled?: boolean }
  /** The row's one button, e.g. Approve 2 or Review. */
  action?: ListRowAction
  /** Enter on the row, or a click on its empty space. Shows a chevron. */
  onOpen?: () => void
  /** With `children`: whether the group's rows show. Enter toggles it when there's no `onOpen`. */
  expanded?: boolean
  onExpandedChange?: (expanded: boolean) => void
  /** e.g. "Show Marcus Quinata's shifts". Defaults to "Show rows". */
  expandLabel?: string
  /** Rows inside this group, shown while expanded. */
  children?: ReactNode
  /** Tints the row. Defaults to a fully checked checkbox. */
  selected?: boolean
  className?: string
}

const INTERACTIVE = 'a, button, input, select, textarea, label, [role="button"], [role="switch"]'

/**
 * A 56px row on touch (48px with a mouse) inside a `ListGroup`. Space toggles
 * its checkbox, Enter opens it or expands its group.
 */
export function ListRow({
  title,
  meta,
  metaWrap = false,
  leading,
  trailing,
  checkbox,
  action,
  onOpen,
  expanded = false,
  onExpandedChange,
  expandLabel = 'Show rows',
  children,
  selected,
  className,
}: ListRowProps) {
  const id = useId()
  const nested = children !== undefined && children !== null && children !== false
  const expandable = nested && Boolean(onExpandedChange)
  const isSelected = selected ?? checkbox?.checked === true
  const toggleExpanded = () => onExpandedChange?.(!expanded)

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // Only when the row itself has focus; its buttons handle their own keys.
    if (event.target !== event.currentTarget || event.altKey || event.ctrlKey || event.metaKey) return
    if (event.key === ' ' && checkbox && !checkbox.disabled) {
      event.preventDefault()
      checkbox.onChange(checkbox.checked !== true)
    } else if (event.key === 'Enter') {
      if (onOpen) { event.preventDefault(); onOpen() } else if (expandable) { event.preventDefault(); toggleExpanded() }
    } else if (expandable && event.key === 'ArrowRight' && !expanded) {
      event.preventDefault(); toggleExpanded()
    } else if (expandable && event.key === 'ArrowLeft' && expanded) {
      event.preventDefault(); toggleExpanded()
    }
  }

  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest(INTERACTIVE)) return
    if (onOpen) onOpen()
    else if (expandable) toggleExpanded()
  }

  return (
    <div role="listitem" className={className}>
      <div
        data-list-row={id}
        role="group"
        aria-labelledby={`${id}-title`}
        aria-describedby={meta ? `${id}-meta` : undefined}
        onKeyDown={onKeyDown}
        onClick={onClick}
        className={cx(
          'flex min-h-14 items-center gap-3 px-3.5 py-2.5 pointer-fine:min-h-12 pointer-fine:px-4 pointer-fine:py-2',
          'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary',
          (onOpen || expandable) && 'cursor-pointer',
          isSelected ? 'bg-primary/5' : 'hover:bg-surface-muted',
        )}
      >
        {checkbox && (
          <Checkbox
            data-list-control
            checked={checkbox.checked}
            onChange={checkbox.onChange}
            label={checkbox.label}
            hideLabel
            disabled={checkbox.disabled}
          />
        )}
        {leading}
        <div className="min-w-0 flex-1">
          <p id={`${id}-title`} className="truncate text-body font-semibold text-ink pointer-fine:text-body-sm">{title}</p>
          {meta && (
            <p
              id={`${id}-meta`}
              className={cx('mt-0.5 text-body-sm text-ink-muted', metaWrap ? 'whitespace-normal' : 'truncate')}
            >
              {meta}
            </p>
          )}
        </div>
        {trailing && <div className="flex shrink-0 items-center gap-2 text-right text-body-sm text-ink">{trailing}</div>}
        {action && (
          <Button
            data-list-control
            size="sm"
            variant={action.variant ?? 'secondary'}
            onClick={action.onClick}
            loading={action.loading}
            disabled={action.disabled}
            aria-label={action.ariaLabel}
            title={action.title}
            className="shrink-0"
          >
            {action.label}
          </Button>
        )}
        {expandable ? (
          <button
            type="button"
            data-list-control
            aria-expanded={expanded}
            aria-controls={`${id}-rows`}
            aria-label={expandLabel}
            onClick={toggleExpanded}
            className="-mr-2 inline-flex size-11 shrink-0 items-center justify-center rounded-control text-ink-subtle hover:bg-surface-muted hover:text-ink pointer-fine:size-9"
          >
            <ChevronDown aria-hidden="true" className={cx('size-5', !expanded && '-rotate-90')} />
          </button>
        ) : onOpen && (
          <ChevronRight aria-hidden="true" className="size-5 shrink-0 text-ink-subtle" />
        )}
      </div>
      {nested && (
        <div id={`${id}-rows`} role="list" aria-labelledby={`${id}-title`} hidden={expandable && !expanded} className="divide-y divide-line border-t border-line bg-slate-50/60 [&_[data-list-row]]:pl-12 pointer-fine:[&_[data-list-row]]:pl-[3.25rem]">
          {(!expandable || expanded) && children}
        </div>
      )}
    </div>
  )
}
