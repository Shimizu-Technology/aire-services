import { useEffect, useState } from 'react'
import { formatBusinessTime } from '../../lib/dateUtils'
import { Button } from '../ui'
import type { SucceededBatch } from './useReviewBatch'

interface RecentApprovalsProps {
  batches: SucceededBatch[]
  busy: boolean
  online: boolean
  onUndo: (batches: SucceededBatch[]) => void
}

export default function RecentApprovals({ batches, busy, online, onUndo }: RecentApprovalsProps) {
  const [now, setNow] = useState(Date.now)
  const available = batches.filter(batch => Date.parse(batch.expiresAt) > now)
  const nextExpiry = Math.min(...available.map(batch => Date.parse(batch.expiresAt)))
  const newestExpiry = Math.max(...available.map(batch => Date.parse(batch.expiresAt)))

  useEffect(() => {
    if (!Number.isFinite(nextExpiry)) return

    const refresh = () => setNow(Date.now())
    const onVisible = () => {
      if (document.visibilityState !== 'hidden') refresh()
    }
    const timeout = window.setTimeout(refresh, Math.max(0, nextExpiry - Date.now()))
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearTimeout(timeout)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [nextExpiry])

  if (!available.length) return null

  const undoAvailable = () => {
    // Recheck at the press as well: a background tab's expiry timer can be delayed.
    const stillAvailable = available.filter(batch => Date.parse(batch.expiresAt) > Date.now())
    if (stillAvailable.length) onUndo(stillAvailable)
    setNow(Date.now())
  }

  return (
    <div
      role="region"
      aria-label="Recent approvals"
      className="flex flex-wrap items-center gap-2 text-body-sm"
    >
      <span>
        Recent approvals · Undo is available until {formatBusinessTime(new Date(newestExpiry))}
      </span>
      <Button
        variant="ghost"
        disabled={busy || !online}
        title={!online ? 'Reconnect to undo' : undefined}
        onClick={undoAvailable}
      >
        Undo recent approvals
      </Button>
    </div>
  )
}
