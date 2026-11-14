import type { ApprovalSelection } from '../../lib/approvalsFilters'
import { ConfirmDialog } from '../ui'
import { formatWorkDate } from '../../lib/dateUtils'
export default function ApproveAllDialog({ selection, exclusions, busy, onConfirm, onCancel, ordinary = true, lockCopy, offline = false }: {
  selection: ApprovalSelection | null; exclusions: string; busy: boolean; onConfirm: () => void; onCancel: () => void; ordinary?: boolean; lockCopy?: string; offline?: boolean
}) {
  if (!selection) return null
  return <ConfirmDialog open title={`Approve ${selection.rows.length}${ordinary ? ' ordinary' : ''} ${selection.rows.length === 1 ? 'shift' : 'shifts'}?`}
    description={`${selection.people.length} ${selection.people.length === 1 ? 'person' : 'people'} · ${formatWorkDate(selection.dates[0])}–${formatWorkDate(selection.dates.at(-1)!)} · ${selection.hours.toFixed(1)}h.${lockCopy ? ` ${lockCopy}` : ''}`}
    details={<><ul>{selection.people.slice(0, 3).map(person => <li key={person.id}>{person.name} · {person.count} {person.count === 1 ? 'shift' : 'shifts'}</li>)}</ul>{selection.people.length > 3 && <p>+ {selection.people.length - 3} more people</p>}
      {exclusions && <p className="rounded-control bg-sky-50 p-3 text-sky-900">Not included: {exclusions}. Review those one at a time.</p>}
      <p>You can undo for 15 minutes. Activity keeps a record of both.</p></>}
    confirmLabel={`Approve ${selection.rows.length} ${selection.rows.length === 1 ? 'shift' : 'shifts'}`} busy={busy} confirmDisabled={offline} confirmDisabledReason="Reconnect to approve" onConfirm={onConfirm} onCancel={onCancel} />
}
