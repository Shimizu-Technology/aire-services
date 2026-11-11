import type { ReactNode } from 'react'
import { WifiOff } from 'lucide-react'
import { cx } from '../../lib/cx'
import { useOnlineStatus } from '../../lib/useOnlineStatus'

const loadedAtFormat = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'Pacific/Guam' })

export interface OfflineBannerProps {
  /** When the data on screen was loaded, for "Showing what was loaded at 7:41 PM." */
  loadedAt?: Date | null
  /** Replaces the default second sentence. */
  children?: ReactNode
  /** Forces the state, for pages that track connectivity themselves. Defaults to the browser's. */
  online?: boolean
  className?: string
}

/**
 * Says the device is offline and that nothing will be saved. Pair it with
 * save buttons disabled through `useOnlineStatus()`. Nothing is queued.
 */
export function OfflineBanner({ loadedAt, children, online, className }: OfflineBannerProps) {
  const browserOnline = useOnlineStatus()
  const isOnline = online ?? browserOnline
  return (
    <div role="status" aria-live="polite">
      {!isOnline && (
        <div className={cx('flex items-start gap-2.5 rounded-card border border-amber-200 bg-amber-50 px-4 py-3 text-body-sm text-amber-900', className)}>
          <WifiOff aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <p>
            <span className="font-semibold">You're offline.</span>{' '}
            {children ?? (loadedAt ? `Showing what was loaded at ${loadedAtFormat.format(loadedAt)}. Nothing can be saved until you reconnect.` : 'Nothing can be saved until you reconnect.')}
          </p>
        </div>
      )}
    </div>
  )
}
