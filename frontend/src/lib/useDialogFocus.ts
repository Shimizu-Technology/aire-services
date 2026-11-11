import { useEffect, useEffectEvent, useSyncExternalStore, type RefObject } from 'react'

let scrollLocks = 0
let previousBodyOverflow = ''
// Open dialogs, newest last. Only the top one handles Escape and Tab, so a
// confirm dialog opened over a modal doesn't close or steal focus from both.
const openDialogs: HTMLElement[] = []
const stackListeners = new Set<() => void>()
const notifyStack = () => stackListeners.forEach(listener => listener())

function subscribeDialogStack(listener: () => void) {
  stackListeners.add(listener)
  return () => { stackListeners.delete(listener) }
}

/** Whether any dialog using useDialogFocus is open, e.g. so a toast behind it can wait. */
export function useAnyDialogOpen() {
  return useSyncExternalStore(subscribeDialogStack, () => openDialogs.length > 0, () => false)
}

/** Shared by dialogs so one closing overlay cannot unlock another. */
export function lockDialogScroll() {
  if (scrollLocks === 0) previousBodyOverflow = document.body.style.overflow
  scrollLocks += 1
  document.body.style.overflow = 'hidden'
  let released = false
  return () => {
    if (released) return
    released = true
    scrollLocks -= 1
    if (scrollLocks === 0) document.body.style.overflow = previousBodyOverflow
  }
}

/** Keep keyboard navigation inside an open dialog and return to its trigger. */
export function useDialogFocus(open: boolean, ref: RefObject<HTMLElement | null>, onClose: () => void, initialFocusSelector?: string) {
  const close = useEffectEvent(onClose)
  useEffect(() => {
    if (!open || !ref.current) return
    const dialog = ref.current
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const unlockScroll = lockDialogScroll()
    openDialogs.push(dialog)
    notifyStack()
    const controls = () => Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])')).filter(element => element.getClientRects().length > 0)
    ;((initialFocusSelector && dialog.querySelector<HTMLElement>(initialFocusSelector)) || controls()[0] || dialog).focus()
    function handleKey(event: KeyboardEvent) {
      if (openDialogs[openDialogs.length - 1] !== dialog) return
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return }
      if (event.key !== 'Tab') return
      const items = controls()
      const first = items[0] || dialog
      const last = items[items.length - 1] || dialog
      if (!dialog.contains(document.activeElement) || (event.shiftKey && document.activeElement === first) || (!event.shiftKey && document.activeElement === last)) {
        event.preventDefault()
        ;(event.shiftKey ? last : first).focus()
      }
    }
    document.addEventListener('keydown', handleKey, true)
    return () => {
      document.removeEventListener('keydown', handleKey, true)
      const index = openDialogs.lastIndexOf(dialog)
      if (index >= 0) openDialogs.splice(index, 1)
      notifyStack()
      unlockScroll()
      if (trigger?.isConnected) trigger.focus()
    }
  }, [open, ref, initialFocusSelector])
}
