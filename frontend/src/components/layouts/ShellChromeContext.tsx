import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { ShellChromeContext } from './shellChrome'

/**
 * Lets page content change the admin shell around it. Today that's one thing:
 * while a SelectionBar is mounted the phone tab bar hides, so the batch action
 * sits under the thumb and switching tabs can't drop the selection.
 */
export function ShellChromeProvider({ children }: { children: ReactNode }) {
  const [approvalCount, setApprovalCount] = useState<number | null>(null)
  const [selectionBars, setSelectionBars] = useState(0)

  const registerSelectionBar = useCallback(() => {
    setSelectionBars(count => count + 1)
    let registered = true
    return () => {
      if (!registered) return
      registered = false
      setSelectionBars(count => count - 1)
    }
  }, [])

  const value = useMemo(() => ({ selectionBarActive: selectionBars > 0, registerSelectionBar, approvalCount, setApprovalCount }), [selectionBars, registerSelectionBar, approvalCount])
  return <ShellChromeContext.Provider value={value}>{children}</ShellChromeContext.Provider>
}
