import { useEffect, useEffectEvent, useSyncExternalStore, type RefObject } from 'react'

let scrollLocks = 0
let previousBodyOverflow = ''
// Open dialogs and popovers, newest last. Only the top layer handles Escape,
// so Escape in a Menu or PersonPicker inside a Sheet closes the popover, and a
// confirm over a modal closes only the confirm. The top modal traps Tab.
interface Layer { element: HTMLElement; modal: boolean }
const layers: Layer[] = []
const topLayer = () => layers[layers.length - 1]
const topModal = () => [...layers].reverse().find(layer => layer.modal)
const stackListeners = new Set<() => void>()
const notifyStack = () => stackListeners.forEach(listener => listener())

function subscribeDialogStack(listener: () => void) {
  stackListeners.add(listener)
  return () => { stackListeners.delete(listener) }
}

/** Whether any dialog using useDialogFocus is open, e.g. so a toast behind it can wait. */
export function useAnyDialogOpen() {
  return useSyncExternalStore(subscribeDialogStack, () => topModal() !== undefined, () => false)
}

function pushLayer(layer: Layer) {
  layers.push(layer)
  notifyStack()
  return () => {
    const index = layers.lastIndexOf(layer)
    if (index >= 0) layers.splice(index, 1)
    notifyStack()
  }
}

/**
 * For popovers (menus, listboxes) that close on Escape. While open they sit
 * on top of any dialog, so Escape closes the popover first and the dialog on
 * the next press. Handles Escape itself; don't also handle it in onKeyDown.
 */
export function useEscapeLayer(open: boolean, ref: RefObject<HTMLElement | null>, onEscape: () => void) {
  const escape = useEffectEvent(onEscape)
  useEffect(() => {
    if (!open || !ref.current) return
    const layer: Layer = { element: ref.current, modal: false }
    const popLayer = pushLayer(layer)
    function handleKey(event: KeyboardEvent) {
      if (event.key !== 'Escape' || topLayer() !== layer) return
      event.preventDefault()
      event.stopPropagation()
      escape()
    }
    document.addEventListener('keydown', handleKey, true)
    return () => {
      document.removeEventListener('keydown', handleKey, true)
      popLayer()
    }
  }, [open, ref])
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
    const layer: Layer = { element: dialog, modal: true }
    const popLayer = pushLayer(layer)
    const controls = () => Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])')).filter(element => element.getClientRects().length > 0)
    ;((initialFocusSelector && dialog.querySelector<HTMLElement>(initialFocusSelector)) || controls()[0] || dialog).focus()
    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        if (topLayer() !== layer) return
        event.preventDefault(); event.stopPropagation(); close(); return
      }
      if (event.key !== 'Tab' || topModal() !== layer) return
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
      popLayer()
      unlockScroll()
      if (trigger?.isConnected) trigger.focus()
    }
  }, [open, ref, initialFocusSelector])
}
