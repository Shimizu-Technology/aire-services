import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { ConfirmDialog, type ConfirmDialogProps } from './ConfirmDialog'

export type ConfirmOptions = Omit<ConfirmDialogProps, 'open' | 'busy' | 'onConfirm' | 'onCancel' | 'confirmLabel'> & {
  confirmLabel?: string
}

/**
 * Promise-based replacement for the browser's native confirm box.
 *
 *   const [confirm, confirmDialog] = useConfirm()
 *   if (!(await confirm({ title: 'Delete this shift?', tone: 'danger', confirmLabel: 'Delete shift' }))) return
 *   ...
 *   return <>{page}{confirmDialog}</>
 *
 * The dialog renders in a portal, so where `confirmDialog` sits in the tree
 * doesn't affect layout. Opening a second request cancels the first.
 */
export function useConfirm(): [(options: ConfirmOptions) => Promise<boolean>, ReactNode] {
  const [options, setOptions] = useState<ConfirmOptions | null>(null)
  const resolver = useRef<((value: boolean) => void) | null>(null)

  const settle = useCallback((value: boolean) => {
    const resolve = resolver.current
    resolver.current = null
    setOptions(null)
    resolve?.(value)
  }, [])

  const confirm = useCallback((next: ConfirmOptions) => new Promise<boolean>((resolve) => {
    resolver.current?.(false)
    resolver.current = resolve
    setOptions(next)
  }), [])

  useEffect(() => () => {
    resolver.current?.(false)
    resolver.current = null
  }, [])

  const dialog = options ? (
    <ConfirmDialog
      {...options}
      open
      confirmLabel={options.confirmLabel ?? 'Confirm'}
      onConfirm={() => settle(true)}
      onCancel={() => settle(false)}
    />
  ) : null

  return [confirm, dialog]
}
