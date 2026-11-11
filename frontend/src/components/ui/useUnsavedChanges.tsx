import { useContext, useEffect, type ReactNode } from 'react'
import { UNSAFE_DataRouterContext } from 'react-router-dom'
import { UnsavedChangesGuard, type UnsavedChangesBarProps, type UnsavedChangesGuardProps } from './UnsavedChangesBar'

export interface UnsavedChangesOptions extends Omit<UnsavedChangesBarProps, 'className'>, Pick<UnsavedChangesGuardProps, 'what' | 'shouldBlock'> {}

export interface UnsavedChangesResult {
  /** Spread onto the page's one `<UnsavedChangesBar>`. */
  barProps: UnsavedChangesBarProps
  /** Render this once on the page. It is the "Leave without saving?" dialog. */
  guard: ReactNode
  /**
   * False when the app isn't on a data router (`createBrowserRouter`). Then
   * only closing or reloading the tab is guarded; in-app links aren't.
   */
  blocksNavigation: boolean
}

/**
 *   const unsaved = useUnsavedChanges({ dirty, what: 'Approvals', onSave: save, onDiscard: reset, saving })
 *   return <>{form}<UnsavedChangesBar {...unsaved.barProps} />{unsaved.guard}</>
 *
 * One hook for the bar and the guard, so they share `dirty` and `onDiscard`.
 * Asks before in-app navigation to another page (React Router's useBlocker
 * with the shared ConfirmDialog: Keep editing / Discard changes) and before
 * the tab closes.
 *
 * React Router supports one active blocker at a time: call this once per
 * page, with `dirty` true when any section has changes, and don't nest a
 * second page that also calls it.
 */
export function useUnsavedChanges({ what, shouldBlock, ...barProps }: UnsavedChangesOptions): UnsavedChangesResult {
  const dataRouter = useContext(UNSAFE_DataRouterContext)
  const { dirty, onDiscard } = barProps

  useEffect(() => {
    if (!dirty) return
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      // Older Chrome and Safari still need returnValue set.
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty])

  return {
    barProps,
    guard: dataRouter ? <UnsavedChangesGuard dirty={dirty} what={what} onDiscard={onDiscard} shouldBlock={shouldBlock} /> : null,
    blocksNavigation: Boolean(dataRouter),
  }
}
