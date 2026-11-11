import { useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { useDialogFocus } from '../../lib/useDialogFocus'
import { IconButton } from './Button'

export interface SheetProps {
  open: boolean
  onClose: () => void
  title: ReactNode
  description?: ReactNode
  children: ReactNode
  /** Pinned below the scrolling body, e.g. Cancel / Save. */
  footer?: ReactNode
  /** CSS selector for the element to focus when the sheet opens. Defaults to the first control. */
  initialFocus?: string
  closeLabel?: string
  /** Fill the phone screen (pickers with long lists). The desktop side panel is full height anyway. */
  fullHeight?: boolean
}

/**
 * A bottom sheet on phones (under 768px) and a right-hand side panel on wider
 * screens. Use for filters and short edits that shouldn't leave the page.
 */
export function Sheet(props: SheetProps) {
  if (!props.open) return null
  return <OpenSheet {...props} />
}

function OpenSheet({ onClose, title, description, children, footer, initialFocus, closeLabel = 'Close', fullHeight = false }: SheetProps) {
  const ids = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  useDialogFocus(true, panelRef, onClose, initialFocus)

  return createPortal(
    <div
      className="fixed inset-0 z-(--z-sheet) flex items-end bg-slate-950/50 transition-opacity duration-200 ease-out starting:opacity-0 md:items-stretch md:justify-end"
      // mousedown, not click: a drag that starts inside the panel and ends on
      // the backdrop must not close the sheet.
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${ids}-title`}
        aria-describedby={description ? `${ids}-description` : undefined}
        tabIndex={-1}
        className={
          (fullHeight ? 'h-[calc(100dvh-env(safe-area-inset-top,0px)-0.75rem)] ' : 'max-h-[85dvh] ') +
          'flex w-full flex-col rounded-t-card bg-surface shadow-2xl ' +
          'transition-transform duration-(--dur-sheet) ease-drawer starting:translate-y-full motion-reduce:transition-none ' +
          'md:h-dvh md:max-h-none md:max-w-md md:rounded-none md:rounded-l-card md:starting:translate-x-full md:starting:translate-y-0'
        }
      >
        <div aria-hidden="true" className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-line-strong md:hidden" />
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-line px-5 pb-3 pt-3 md:pt-5">
          <div className="min-w-0">
            <h2 id={`${ids}-title`} className="text-title font-semibold text-ink">{title}</h2>
            {description && <p id={`${ids}-description`} className="mt-1 text-body-sm text-ink-muted">{description}</p>}
          </div>
          <IconButton label={closeLabel} icon={<X className="size-5" />} variant="ghost" onClick={onClose} className="-mr-2 shrink-0 text-ink-muted" />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">{children}</div>
        {footer && <div className="shrink-0 border-t border-line px-5 pb-safe-4 pt-4">{footer}</div>}
        {!footer && <div className="pb-safe shrink-0" />}
      </div>
    </div>,
    document.body,
  )
}
