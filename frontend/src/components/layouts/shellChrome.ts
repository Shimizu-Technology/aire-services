import { createContext, useContext, useEffect } from 'react'

export interface ShellChrome {
  /** A SelectionBar is showing. On phones it takes the tab bar's place. */
  selectionBarActive: boolean
  approvalCount: number | null
  allApprovalCount: number | null
  refreshApprovalCount: () => Promise<void> | void
  /** Returns the unregister function. Counted, so two bars can't leave the tab bar hidden. */
  registerSelectionBar: () => () => void
}

// Outside the admin shell (component tests, the kiosk) nothing reacts.
export const ShellChromeContext = createContext<ShellChrome>({
  selectionBarActive: false,
  approvalCount: null,
  allApprovalCount: null,
  refreshApprovalCount: () => undefined,
  registerSelectionBar: () => () => undefined,
})

export function useShellChrome() {
  return useContext(ShellChromeContext)
}

/** Tell the shell a selection bar is showing while `active` is true. */
export function useSelectionBarRegistration(active: boolean) {
  const { registerSelectionBar } = useShellChrome()
  useEffect(() => (active ? registerSelectionBar() : undefined), [active, registerSelectionBar])
}
