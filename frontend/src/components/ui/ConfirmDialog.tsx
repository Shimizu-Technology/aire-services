import { useId, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle } from 'lucide-react'
import { useDialogFocus } from '../../lib/useDialogFocus'
import { cx } from '../../lib/cx'
import { Button } from './Button'

export interface ConfirmDialogProps {
  open: boolean
  /** The question, e.g. "Delete this shift?" */
  title: ReactNode
  /** What happens if they confirm. */
  description?: ReactNode
  /** Extra detail below the description: a summary list, warning, or affected items. */
  details?: ReactNode
  /** A verb for the action, e.g. "Delete shift" or "Approve 12 entries". */
  confirmLabel: string
  cancelLabel?: string
  /** `danger` uses a red action and focuses Cancel first. */
  tone?: 'default' | 'danger'
  /** Shows a spinner on the action and blocks closing while work runs. */
  busy?: boolean
  /** Disable just the save action, e.g. offline, while Cancel stays usable. */
  confirmDisabled?: boolean
  confirmDisabledReason?: string
  /** When set, the action stays disabled until this exact text is typed. */
  requireText?: string
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog(props: ConfirmDialogProps) {
  if (!props.open) return null
  return <OpenConfirmDialog {...props} />
}

function OpenConfirmDialog({
  title,
  description,
  details,
  confirmLabel,
  cancelLabel = 'Cancel',
  tone = 'default',
  busy = false,
  confirmDisabled = false,
  confirmDisabledReason,
  requireText,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const ids = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  const [typed, setTyped] = useState('')
  const danger = tone === 'danger'
  const initialFocus = requireText
    ? '[data-confirm-input]'
    : danger
      ? '[data-confirm-cancel]'
      : '[data-confirm-action]'
  useDialogFocus(
    true,
    dialogRef,
    () => {
      if (!busy) onCancel()
    },
    initialFocus,
  )
  const blocked = Boolean(requireText) && typed.trim() !== requireText

  return createPortal(
    <div
      className="fixed inset-0 z-(--z-dialog) flex items-end justify-center bg-slate-950/50 p-3 pb-safe-3 transition-opacity duration-200 ease-out starting:opacity-0 sm:items-center sm:p-6"
      onClick={event => {
        if (event.target === event.currentTarget && !busy) onCancel()
      }}
    >
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={`${ids}-title`}
        aria-describedby={description || details ? `${ids}-body` : undefined}
        tabIndex={-1}
        className="w-full max-w-md rounded-card bg-surface p-5 shadow-2xl transition duration-200 ease-out-strong starting:translate-y-2 starting:scale-[0.98] starting:opacity-0 motion-reduce:transform-none sm:p-6"
      >
        <div className="flex gap-3">
          {danger && (
            <span
              aria-hidden="true"
              className="mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-danger-soft text-danger"
            >
              <AlertTriangle className="size-5" />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <h2
              id={`${ids}-title`}
              className="text-title font-semibold text-ink"
            >
              {title}
            </h2>
            {(description || details) && (
              <div
                id={`${ids}-body`}
                className="mt-2 space-y-3 text-body-sm text-ink-muted"
              >
                {description && <p>{description}</p>}
                {details}
              </div>
            )}
          </div>
        </div>
        {requireText && (
          <div className="mt-4">
            <label
              htmlFor={`${ids}-typed`}
              className="block text-sm font-medium text-ink"
            >
              Type <span className="font-semibold">{requireText}</span> to confirm
            </label>
            <input
              id={`${ids}-typed`}
              data-confirm-input
              value={typed}
              onChange={event => setTyped(event.target.value)}
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className="mt-2 min-h-11 w-full rounded-control border border-line-strong px-3 text-body text-ink pointer-fine:text-body-sm"
            />
          </div>
        )}
        <div className={cx('mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end')}>
          <Button
            data-confirm-cancel
            variant="secondary"
            onClick={onCancel}
            disabled={busy}
            className="w-full sm:w-auto"
          >
            {cancelLabel}
          </Button>
          <Button
            data-confirm-action
            variant={danger ? 'danger' : 'primary'}
            onClick={onConfirm}
            loading={busy}
            disabled={blocked || confirmDisabled}
            title={confirmDisabled ? confirmDisabledReason : undefined}
            className="w-full sm:w-auto"
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
