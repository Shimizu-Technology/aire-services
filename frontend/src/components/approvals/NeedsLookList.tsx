import type { ReviewEntry } from '../../lib/api/approvals'
import { formatWorkDate } from '../../lib/dateUtils'
import { Avatar, ListGroup, ListRow, StatusPill } from '../ui'
export default function NeedsLookList({ rows, onReview, viewerId }: { rows: ReviewEntry[]; onReview: (entry: ReviewEntry) => void; viewerId?: number }) {
  if (!rows.length) return null
  return <section aria-labelledby="needs-look-title" className="space-y-2">
    <h2 id="needs-look-title" className="text-body font-semibold text-ink">Needs a look · {rows.length}</h2>
    <ListGroup label="Needs a look">{rows.map(row => <ListRow key={row.id}
      leading={<span className="hidden sm:inline-flex"><Avatar name={row.user.full_name} size="sm" /></span>}
      title={row.user.id === viewerId ? 'You' : row.user.full_name}
      meta={<>{formatWorkDate(row.work_date)} · {row.hours.toFixed(1)}h{row.overtime_status === 'pending' ? ` · ${(row.pending_overtime_hours ?? 0).toFixed(1)}h overtime waiting` : ''}<span className="mt-1 flex flex-wrap gap-1 whitespace-normal">{row.exceptions.map(reason => <StatusPill key={reason.key} tone={reason.key === 'needs_another_approver' ? 'off' : 'waiting'}>{reason.label}</StatusPill>)}</span></>}
      action={row.needs_another_approver || row.exceptions.some(reason => reason.key === 'needs_another_approver') ? undefined : { label: 'Review', ariaLabel: `Review ${row.user.full_name}, ${row.work_date}`, onClick: () => onReview(row) }}
      onOpen={row.needs_another_approver ? undefined : () => onReview(row)} />)}</ListGroup>
  </section>
}
