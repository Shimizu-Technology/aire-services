import { useContext } from 'react'
import { ToastContext, type ToastApi } from './toastContext'

/**
 *   const toast = useToast()
 *   toast.show({ message: 'Approved 2 shifts for Marcus Quinata', action: { label: 'Undo', onAction: undo } })
 *
 * Needs a ToastProvider above it. AdminLayout has one.
 */
export function useToast(): ToastApi {
  const api = useContext(ToastContext)
  if (!api) throw new Error('useToast needs a <ToastProvider> above it')
  return api
}
