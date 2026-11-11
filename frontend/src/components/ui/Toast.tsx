import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'
import { cx } from '../../lib/cx'
import { usePrefersReducedMotion } from '../../lib/useMediaQuery'
import { useShellChrome } from '../layouts/shellChrome'
import { ToastContext, type ToastApi, type ToastOptions } from './toastContext'

export const TOAST_DEFAULT_DURATION = 10_000
const EXIT_MS = 150
const EXIT_REDUCED_MS = 100

interface ToastRecord {
  id: number
  options: ToastOptions
  closing: boolean
}

/**
 * Holds the one toast the admin shows at a time and renders it above the tab
 * bar (or selection bar) on phones and bottom-right on desktop.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastRecord | null>(null)
  const nextId = useRef(1)
  const reducedMotion = usePrefersReducedMotion()
  const exitMs = reducedMotion ? EXIT_REDUCED_MS : EXIT_MS

  const show = useCallback((options: ToastOptions) => {
    const id = nextId.current++
    setToast({ id, options, closing: false })
    return id
  }, [])

  const dismiss = useCallback((id?: number) => {
    setToast(current => (current && (id === undefined || current.id === id) ? { ...current, closing: true } : current))
  }, [])

  // Keep a closing toast mounted until its exit transition ends.
  useEffect(() => {
    if (!toast?.closing) return
    const timer = window.setTimeout(() => setToast(current => (current?.id === toast.id ? null : current)), exitMs)
    return () => window.clearTimeout(timer)
  }, [toast, exitMs])

  const api = useMemo<ToastApi>(() => ({ show, dismiss }), [show, dismiss])

  return (
    <ToastContext.Provider value={api}>
      {children}
      <Toaster toast={toast} reducedMotion={reducedMotion} onDismiss={dismiss} />
    </ToastContext.Provider>
  )
}

function Toaster({ toast, reducedMotion, onDismiss }: { toast: ToastRecord | null; reducedMotion: boolean; onDismiss: (id?: number) => void }) {
  const { selectionBarActive } = useShellChrome()
  return (
    // Always mounted so screen readers hear each new message.
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className={cx(
        'pointer-events-none fixed inset-x-3 z-(--z-toast) flex justify-center',
        'bottom-[calc(5rem+env(safe-area-inset-bottom,0px))] lg:inset-x-auto lg:right-8',
        selectionBarActive ? 'lg:bottom-24' : 'lg:bottom-8',
      )}
    >
      {toast && <ToastView key={toast.id} toast={toast} reducedMotion={reducedMotion} onDismiss={() => onDismiss(toast.id)} />}
    </div>
  )
}

function ToastView({ toast, reducedMotion, onDismiss }: { toast: ToastRecord; reducedMotion: boolean; onDismiss: () => void }) {
  const { message, action, tone = 'default', duration = TOAST_DEFAULT_DURATION } = toast.options
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const [hidden, setHidden] = useState(() => document.visibilityState === 'hidden')
  const remaining = useRef(duration)
  // Where focus came from, so closing the toast doesn't drop a keyboard user on <body>.
  const returnFocus = useRef<HTMLElement | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const paused = hovered || focused || hidden || toast.closing
  const expire = useEffectEvent(onDismiss)

  const close = () => {
    const hadFocus = rootRef.current?.contains(document.activeElement)
    onDismiss()
    if (hadFocus && returnFocus.current?.isConnected) returnFocus.current.focus()
  }

  useEffect(() => {
    const onVisibility = () => setHidden(document.visibilityState === 'hidden')
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  // Count down only while nobody is reading or using it.
  useEffect(() => {
    if (paused) return
    const startedAt = Date.now()
    const timer = window.setTimeout(() => expire(), remaining.current)
    return () => {
      window.clearTimeout(timer)
      remaining.current = Math.max(0, remaining.current - (Date.now() - startedAt))
    }
  }, [paused])

  return (
    <div
      ref={rootRef}
      data-state={toast.closing ? 'closing' : 'open'}
      data-motion={reducedMotion ? 'reduced' : 'full'}
      onPointerEnter={(event) => { if (event.pointerType === 'mouse') setHovered(true) }}
      onPointerLeave={() => setHovered(false)}
      onFocus={(event) => {
        const from = event.relatedTarget
        if (from instanceof HTMLElement && !event.currentTarget.contains(from)) returnFocus.current = from
        setFocused(true)
      }}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false) }}
      onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); close() } }}
      className={cx(
        'pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-card bg-ink py-1.5 pl-4 pr-1.5 text-body-sm text-white shadow-[0_12px_30px_rgb(15_23_42/0.3)] lg:w-[27.5rem]',
        // Up from the bottom on enter, back down on exit. Reduced motion keeps a short fade only.
        'transition-[translate,opacity] ease-out-strong',
        reducedMotion
          ? 'duration-100 starting:opacity-0'
          : 'duration-200 starting:translate-y-4 starting:opacity-0',
        toast.closing && (reducedMotion ? 'opacity-0' : 'translate-y-4 opacity-0 duration-150'),
      )}
    >
      {tone === 'danger' && <AlertTriangle aria-hidden="true" className="size-4 shrink-0 text-red-300" />}
      <p className="min-w-0 flex-1 py-2 [overflow-wrap:anywhere]">{message}</p>
      {action && (
        <button
          type="button"
          onClick={() => { close(); action.onAction() }}
          className="inline-flex min-h-11 shrink-0 items-center rounded-control px-3 font-semibold text-sky-300 transition-colors duration-150 hover:bg-white/10 focus-visible:outline-white"
        >
          {action.label}
        </button>
      )}
    </div>
  )
}
