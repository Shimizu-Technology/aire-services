import { Link } from 'react-router-dom'
import type { WorkerStatus } from '../../lib/api'
import { formatApprovalDate } from '../../lib/approvalsDates'
import { formatBusinessTime } from '../../lib/dateUtils'

export default function ApprovalsAttention({ workers }: { workers: WorkerStatus[] }) {
  return (
    <>
      {workers.map(worker => {
        const date = worker.open_since_work_date!
        const time = worker.clock_in_at ? `, ${formatBusinessTime(worker.clock_in_at)}` : ''
        const target = new URLSearchParams({
          entry_id: String(worker.open_entry_id),
          date,
          user_id: String(worker.user.id),
        })

        return (
          <div
            key={worker.user.id}
            className="rounded-card border border-amber-200 bg-amber-50 px-4 py-3 text-body-sm"
          >
            <strong>{worker.user.full_name}</strong> is still clocked in from{' '}
            {formatApprovalDate(date)}
            {time}.{' '}
            <Link
              className="inline-flex min-h-11 items-center font-semibold underline"
              to={`/admin/timecards?${target}`}
            >
              Fix clock-out
            </Link>
          </div>
        )
      })}
    </>
  )
}
