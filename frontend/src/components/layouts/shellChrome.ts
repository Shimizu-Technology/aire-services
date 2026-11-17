import { createContext, useContext, useEffect, useLayoutEffect, type RefObject } from 'react'

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
const barHeights = new Map<symbol, number>()

export function useSelectionBarRegistration(active: boolean, ref?: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const element = ref?.current
    if (!active || !element) return
    const key = Symbol()
    const update = () => {
      barHeights.set(key, element.getBoundingClientRect().height)
      document.documentElement.style.setProperty('--selection-bar-height', `${Math.max(...barHeights.values())}px`)
    }
    update()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
    observer?.observe(element)
    window.addEventListener('resize', update)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', update)
      barHeights.delete(key)
      if (barHeights.size) document.documentElement.style.setProperty('--selection-bar-height', `${Math.max(...barHeights.values())}px`)
      else document.documentElement.style.removeProperty('--selection-bar-height')
    }
  }, [active, ref])
  const { registerSelectionBar } = useShellChrome()
  useEffect(() => (active ? registerSelectionBar() : undefined), [active, registerSelectionBar])
}
