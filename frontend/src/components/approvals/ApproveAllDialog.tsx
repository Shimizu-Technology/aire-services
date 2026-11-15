import type { ApprovalSelection } from '../../lib/approvalsFilters'
import { ConfirmDialog } from '../ui'
import { formatApprovalDate } from '../../lib/approvalsDates'
export default function ApproveAllDialog({
  selection,
  exclusions,
  excludedPeople = 0,
  busy,
  onConfirm,
  onCancel,
  ordinary = true,
  lockCopy,
  disabled = false,
  disabledReason,
}: {
  selection: ApprovalSelection | null
  exclusions: string
  excludedPeople?: number
  busy: boolean
  onConfirm: () => void
  onCancel: () => void
  ordinary?: boolean
  lockCopy?: string
  disabled?: boolean
  disabledReason?: string
}) {
  if (!selection) return null
  const shiftNoun = selection.rows.length === 1 ? 'shift' : 'shifts'
  const personNoun = selection.people.length === 1 ? 'person' : 'people'
  const dates = [...new Set(selection.dates)]
  const dateRange = [dates[0], ...(dates.length > 1 ? [dates.at(-1)!] : [])]
    .map((date) => formatApprovalDate(date))
    .join('–')
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
            {selection.people.slice(0, 3).map((person) => (
              <li key={person.id}>
                {person.name} · {person.count} {person.count === 1 ? 'shift' : 'shifts'}
              </li>
            ))}
          </ul>
          {selection.people.length > 3 && (
            <p>
              + {selection.people.length - 3} more{' '}
              {selection.people.length === 4 ? 'person' : 'people'}
            </p>
          )}
          {exclusions && (
            <div className="space-y-2 rounded-control bg-sky-50 p-3 text-sky-900">
              <p>
                Not included: {excludedPeople}{' '}
                {excludedPeople === 1 ? "person's" : "people's"} shifts that need a look
                (overtime, edits, added time). They stay in the list.
              </p>
              <details>
                <summary className="min-h-11 cursor-pointer py-2 font-semibold">
                  Show who
                </summary>
                <ul className="space-y-2">
                  {exclusions.split('; ').map((person) => (
                    <li key={person}>{person}</li>
                  ))}
                </ul>
              </details>
            </div>
          )}
          <p>You can undo for 15 minutes.</p>
        </>
      }
      confirmLabel={`Approve ${selection.rows.length} ${shiftNoun}`}
      busy={busy}
      confirmDisabled={disabled}
      confirmDisabledReason={disabledReason}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  )
}
