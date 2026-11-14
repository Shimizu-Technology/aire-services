import type { ReviewEntry } from '../../lib/api/approvals'
import { formatApprovalDate, formatApprovalDateRange } from '../../lib/approvalsDates'
import { businessWeekStart } from '../../lib/dateUtils'
import { Avatar, ListGroup, ListRow, StatusPill } from '../ui'
import { isTinyShift, reasonChips } from './reviewPresentation'

export default function NeedsLookList({
  rows,
  onReview,
  viewerId,
}: {
  rows: ReviewEntry[]
  onReview: (entry: ReviewEntry) => void
  viewerId?: number
}) {
  if (!rows.length) return null
  const groups = new Map<string, ReviewEntry[]>()
  for (const row of rows) {
    const key = `${row.user.id}/${businessWeekStart(row.work_date)}`
    groups.set(key, [...(groups.get(key) ?? []), row])
  }
  return (
    <section aria-labelledby="needs-look-title" className="space-y-2">
      <h2 id="needs-look-title" className="text-body font-semibold text-ink">
        Needs a look · {rows.length}
      </h2>
      <ListGroup label="Needs a look">
        {[...groups].map(([key, entries]) => {
          const row = entries[0]
          const reviewable = entries.find(
            (entry) =>
              !entry.needs_another_approver &&
              !entry.exceptions.some((reason) => reason.key === 'needs_another_approver'),
          )
          const overtime = entries.some(
            (entry) =>
              entry.overtime_status === 'pending' ||
              entry.exceptions.some((reason) => reason.key === 'overtime'),
          )
          const overtimeHours = entries.reduce(
            (sum, entry) => sum + (entry.pending_overtime_hours ?? 0),
            0,
          )
          const reasons = reasonChips(entries)
          const name = row.user.id === viewerId ? 'You' : row.user.full_name
          const open = reviewable ? () => onReview(reviewable) : undefined
          return (
            <ListRow
              key={key}
              leading={
                <span className="hidden sm:inline-flex">
                  <Avatar name={row.user.full_name} size="sm" />
                </span>
              }
              title={name}
              metaWrap
              meta={
                <>
                  {entries.length === 1
                    ? `${formatApprovalDate(row.work_date)} · ${row.hours.toFixed(1)}h`
                    : `${entries.length} shifts this week · ${formatApprovalDateRange(entries.map((entry) => entry.work_date))}`}
                  {overtime &&
                    (overtimeHours > 0
                      ? ` · ${overtimeHours.toFixed(1)}h overtime waiting`
                      : ' · Overtime to review')}
                  {entries.some(isTinyShift) && (
                    <span className="block font-medium text-amber-800">
                      Under 1 minute, probably a mis-tap
                    </span>
                  )}
                  <span className="mt-1 flex flex-wrap gap-1 whitespace-normal">
                    {reasons.map((reason) => (
                      <StatusPill
                        key={reason.key}
                        tone={reason.key === 'needs_another_approver' ? 'off' : 'waiting'}
                      >
                        {reason.label}
                      </StatusPill>
                    ))}
                  </span>
                </>
              }
              action={
                open
                  ? {
                      label: 'Review',
                      ariaLabel: `Review ${row.user.full_name}, week of ${businessWeekStart(row.work_date)}`,
                      onClick: open,
                    }
                  : undefined
              }
              onOpen={open}
            />
          )
        })}
      </ListGroup>
    </section>
  )
}
