import { createContext, type ReactNode } from 'react'

export interface ToastOptions {
  /** One sentence saying what happened: "Approved 2 shifts for Marcus Quinata". */
  message: ReactNode
  /** At most one action, usually Undo. The toast closes after it runs. */
  action?: { label: string; onAction: () => void }
  /** How long it stays, in ms. Paused while hovered, focused or the tab is hidden. */
  duration?: number
  /** `danger` adds a warning icon for refusals ("Can't undo 1 of 2…"). */
  tone?: 'default' | 'danger'
}

export interface ToastApi {
  /** Shows a toast, replacing any that is open. Returns its id. */
  show: (options: ToastOptions) => number
  /** Closes the toast with this id, or whichever is open. */
  dismiss: (id?: number) => void
}

export const ToastContext = createContext<ToastApi | null>(null)
