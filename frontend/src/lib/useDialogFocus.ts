import { useEffect, useEffectEvent, type RefObject } from 'react'

let scrollLocks = 0
let previousBodyOverflow = ''

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
export function useDialogFocus(open: boolean, ref: RefObject<HTMLElement | null>, onClose: () => void) {
  const close = useEffectEvent(onClose)
  useEffect(() => {
    if (!open || !ref.current) return
    const dialog = ref.current
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const unlockScroll = lockDialogScroll()
    const controls = () => Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])')).filter(element => element.getClientRects().length > 0)
    ;(controls()[0] || dialog).focus()
    function handleKey(event: KeyboardEvent) {
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
      unlockScroll()
      if (trigger?.isConnected) trigger.focus()
    }
  }, [open, ref])
}
