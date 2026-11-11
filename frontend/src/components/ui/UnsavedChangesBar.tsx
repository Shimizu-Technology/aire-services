import { useId, type ReactNode } from 'react'
import { useBlocker } from 'react-router-dom'
import { cx } from '../../lib/cx'
import { useSelectionBarRegistration } from '../layouts/shellChrome'
import { Button } from './Button'
import { ConfirmDialog } from './ConfirmDialog'
import { blockPathChanges, type ShouldBlock } from './unsavedChangesBlocking'

export interface UnsavedChangesBarProps {
  /** The bar shows while this is true. */
  dirty: boolean
  onSave: () => void
  onDiscard: () => void
  saving?: boolean
  /** What changed, e.g. "Role: Employee → Manager". Defaults to the message. */
  summary?: ReactNode
  message?: string
  saveLabel?: string
  discardLabel?: string
  /** Disables Save, e.g. offline or a field is invalid. Say why in `saveDisabledReason`. */
  saveDisabled?: boolean
  saveDisabledReason?: string
  className?: string
}

/**
 * The one Save for a page or tab. Pinned to the bottom while there are
 * changes; on phones it takes the tab bar's place like the SelectionBar, so
 * Save stays under the thumb. Get its props from `useUnsavedChanges`, which
 * also guards navigation with the same `dirty` and `onDiscard`.
 */
export function UnsavedChangesBar({
  dirty,
  onSave,
  onDiscard,
  saving = false,
  summary,
  message = 'You have unsaved changes',
  saveLabel = 'Save changes',
  discardLabel = 'Discard',
  saveDisabled = false,
  saveDisabledReason,
  className,
}: UnsavedChangesBarProps) {
  const ids = useId()
  useSelectionBarRegistration(dirty)
  return (
    <>
      <p aria-live="polite" className="sr-only">{dirty ? message : ''}</p>
      {dirty && (
        <div
          role="region"
          aria-label="Unsaved changes"
          className={cx(
            'z-(--z-tabbar) flex items-center gap-3 bg-surface pt-3 shadow-raised',
            'fixed inset-x-0 bottom-0 pb-safe-3 pl-[max(1rem,env(safe-area-inset-left,0px))] pr-[max(1rem,env(safe-area-inset-right,0px))]',
            'lg:sticky lg:inset-x-auto lg:mt-6 lg:rounded-card lg:border lg:border-line lg:px-5 lg:pb-3',
            className,
          )}
        >
          <p className="min-w-0 flex-1 text-body-sm">
            <span className="block font-semibold text-ink">{summary ? 'Unsaved change' : message}</span>
            {summary && <span className="block truncate text-ink-muted">{summary}</span>}
          </p>
          <Button variant="ghost" onClick={onDiscard} disabled={saving} className="shrink-0">{discardLabel}</Button>
          <Button
            onClick={onSave}
            loading={saving}
            disabled={saveDisabled}
            title={saveDisabled ? saveDisabledReason : undefined}
            aria-describedby={saveDisabled && saveDisabledReason ? `${ids}-reason` : undefined}
            className="shrink-0"
          >
            {saveLabel}
          </Button>
          {saveDisabled && saveDisabledReason && <span id={`${ids}-reason`} className="sr-only">{saveDisabledReason}</span>}
        </div>
      )}
    </>
  )
}

export interface UnsavedChangesGuardProps {
  dirty: boolean
  /** Names what would be lost: "Approvals" gives "Your changes to Approvals will be lost." */
  what?: string
  /** Called before leaving when they choose Discard changes. */
  onDiscard?: () => void
  /**
   * Which moves need asking. Defaults to `blockPathChanges`: a different page.
   * Query and hash changes on the same page (a filter, ?tab=) are free; use
   * `blockPathOrParams('tab')` when the draft belongs to one tab.
   */
  shouldBlock?: ShouldBlock
}

/**
 * Asks before in-app navigation drops unsaved changes. Needs a data router;
 * use through `useUnsavedChanges`. React Router allows one active blocker at
 * a time, so render one guard per page and combine every section's `dirty`.
 */
export function UnsavedChangesGuard({ dirty, what, onDiscard, shouldBlock = blockPathChanges }: UnsavedChangesGuardProps) {
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && shouldBlock(currentLocation, nextLocation))
  return (
    <ConfirmDialog
      open={blocker.state === 'blocked'}
      title="Leave without saving?"
      description={what ? `Your changes to ${what} will be lost.` : 'Your changes will be lost.'}
      tone="danger"
      confirmLabel="Discard changes"
      cancelLabel="Keep editing"
      onConfirm={() => { onDiscard?.(); blocker.proceed?.() }}
      onCancel={() => blocker.reset?.()}
    />
  )
}
