import { useContext, useEffect, type ReactNode } from 'react'
import { UNSAFE_DataRouterContext } from 'react-router-dom'
import { UnsavedChangesGuard, type UnsavedChangesGuardProps } from './UnsavedChangesBar'

export interface UnsavedChangesResult {
  /** Render this once on the page. It is the "Leave without saving?" dialog. */
  guard: ReactNode
  /**
   * False when the app isn't on a data router (`createBrowserRouter`). Then
   * only closing or reloading the tab is guarded; in-app links aren't.
   */
  blocksNavigation: boolean
}

/**
 *   const { guard } = useUnsavedChanges({ dirty, what: 'Approvals', onDiscard: reset })
 *   return <>{form}<UnsavedChangesBar dirty={dirty} … />{guard}</>
 *
 * Asks before in-app navigation (React Router's useBlocker with the shared
 * ConfirmDialog: Keep editing / Discard changes) and before the tab closes.
 */
export function useUnsavedChanges(options: UnsavedChangesGuardProps): UnsavedChangesResult {
  const dataRouter = useContext(UNSAFE_DataRouterContext)
  const { dirty } = options

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
    guard: dataRouter ? <UnsavedChangesGuard {...options} /> : null,
    blocksNavigation: Boolean(dataRouter),
  }
}
