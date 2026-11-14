import type { ApprovalSelection } from '../../lib/approvalsFilters'
import { ConfirmDialog } from '../ui'
import { formatWorkDate } from '../../lib/dateUtils'
export default function ApproveAllDialog({
  selection,
  exclusions,
  busy,
  onConfirm,
  onCancel,
  ordinary = true,
  lockCopy,
  offline = false,
}: {
  selection: ApprovalSelection | null
  exclusions: string
  busy: boolean
  onConfirm: () => void
  onCancel: () => void
  ordinary?: boolean
  lockCopy?: string
  offline?: boolean
}) {
  if (!selection) return null
  const shiftNoun = selection.rows.length === 1 ? 'shift' : 'shifts'
  const personNoun = selection.people.length === 1 ? 'person' : 'people'
  const dateRange = [
    formatWorkDate(selection.dates[0]),
    formatWorkDate(selection.dates.at(-1)!),
  ].join('–')
  const summary = [
    `${selection.people.length} ${personNoun}`,
    dateRange,
    `${selection.hours.toFixed(1)}h.${lockCopy ? ` ${lockCopy}` : ''}`,
  ].join(' · ')
  return (
    <ConfirmDialog
      open
      title={`Approve ${selection.rows.length}${ordinary ? ' ordinary' : ''} ${shiftNoun}?`}
      description={summary}
      details={
        <>
          <ul>
            {selection.people.slice(0, 3).map(person => (
              <li key={person.id}>
                {person.name} · {person.count} {person.count === 1 ? 'shift' : 'shifts'}
              </li>
            ))}
          </ul>
          {selection.people.length > 3 && <p>+ {selection.people.length - 3} more people</p>}
          {exclusions && (
            <p className="rounded-control bg-sky-50 p-3 text-sky-900">
              Not included: {exclusions}. Review those one at a time.
            </p>
          )}
          <p>You can undo for 15 minutes. Activity keeps a record of both.</p>
        </>
      }
      confirmLabel={`Approve ${selection.rows.length} ${shiftNoun}`}
      busy={busy}
      confirmDisabled={offline}
      confirmDisabledReason="Reconnect to approve"
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  )
}
