import { useEffect, useState } from 'react'
import { formatBusinessTime } from '../../lib/dateUtils'
import { Button } from '../ui'
import type { SucceededBatch } from './useReviewBatch'

function recentBatchLabel(batch: SucceededBatch) {
  const shifts = `${batch.count} ${batch.count === 1 ? 'shift' : 'shifts'}`
  return batch.people?.length === 1
    ? `${batch.people[0].name} · ${shifts}`
    : batch.people?.length
      ? `${shifts} for ${batch.people.length} people`
      : shifts
}

interface RecentApprovalsProps {
  batches: SucceededBatch[]
  busy: boolean
  online: boolean
  onUndo: (batches: SucceededBatch[]) => void
}

export default function RecentApprovals({ batches, busy, online, onUndo }: RecentApprovalsProps) {
  const [now, setNow] = useState(Date.now)
  const available = batches
    .filter(batch => Date.parse(batch.expiresAt) > now)
    .sort((a, b) => Date.parse(b.expiresAt) - Date.parse(a.expiresAt))
  const nextExpiry = Math.min(...available.map(batch => Date.parse(batch.expiresAt)))

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

  return (
    <div
      role="region"
      aria-label="Recent approvals"
      className="flex flex-wrap items-center gap-2 text-body-sm"
    >
      <h2 className="w-full font-semibold">Recent approvals</h2>
      {available.map(batch => (
        <div
          key={batch.id}
          className="flex w-full flex-wrap items-center gap-2"
        >
          <span>
            {recentBatchLabel(batch)} · until {formatBusinessTime(new Date(batch.expiresAt))}
          </span>
          <Button
            variant="ghost"
            disabled={busy || !online}
            title={!online ? 'Reconnect to undo' : undefined}
            aria-label={`Undo ${recentBatchLabel(batch)}`}
            onClick={() => {
              if (Date.parse(batch.expiresAt) > Date.now()) onUndo([batch])
              setNow(Date.now())
            }}
          >
            Undo
          </Button>
        </div>
      ))}
    </div>
  )
}
