import { useState } from 'react'
import type { ReviewEntry } from '../../lib/api/approvals'
import { formatWorkDate } from '../../lib/dateUtils'
import { Avatar, ListGroup, ListRow } from '../ui'

export default function OrdinaryGroups({ rows, groupBy, selected, onSelect, onApprove, disabled, disabledReason }: {
  rows: ReviewEntry[]; groupBy: 'person' | 'day'; selected: Set<number>; onSelect: (rows: ReviewEntry[], checked: boolean) => void
  onApprove: (rows: ReviewEntry[], name: string) => void; disabled: boolean; disabledReason?: string
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const groups = new Map<string, ReviewEntry[]>()
  rows.forEach(row => { const key = groupBy === 'person' ? String(row.user.id) : row.work_date; groups.set(key, [...(groups.get(key) ?? []), row]) })
  return <ListGroup label={`Ordinary shifts by ${groupBy}`} className="overscroll-contain">
    {[...groups].map(([key, entries]) => {
      const title = groupBy === 'person' ? entries[0].user.full_name : formatWorkDate(key)
      const count = entries.filter(entry => selected.has(entry.id)).length
      const dates = entries.map(row => row.work_date).sort()
      return <ListRow key={`${groupBy}-${key}`} title={title}
        leading={groupBy === 'person' ? <span className="hidden sm:inline-flex"><Avatar name={title} size="sm" /></span> : undefined}
        meta={`${entries.length} shifts · ${groupBy === 'person' ? `${dates[0].slice(5)}–${dates.at(-1)!.slice(5)} · ` : ''}${entries.reduce((sum, row) => sum + row.hours, 0).toFixed(1)}h`}
        checkbox={{ checked: count === 0 ? false : count === entries.length ? true : 'mixed', label: `Select ${title}`, onChange: checked => onSelect(entries, checked), disabled }}
        action={{ label: `Approve ${entries.length}`, ariaLabel: `Approve ${entries.length} shifts for ${title}`, onClick: () => onApprove(entries, title), disabled, title: disabledReason }}
        expanded={expanded.has(key)} onExpandedChange={open => setExpanded(current => { const next = new Set(current); if (open) next.add(key); else next.delete(key); return next })}
        expandLabel={`Show shifts for ${title}`}>
        {entries.map(entry => <ListRow key={entry.id} title={groupBy === 'day' ? entry.user.full_name : formatWorkDate(entry.work_date)}
          meta={`${entry.formatted_start_time || entry.start_time || '—'}–${entry.formatted_end_time || entry.end_time || '—'} · ${entry.time_category?.name || 'No work category'} · ${entry.hours.toFixed(1)}h`}
          checkbox={{ checked: selected.has(entry.id), label: `Select ${entry.user.full_name}, ${entry.work_date}`, onChange: checked => onSelect([entry], checked), disabled }} />)}
      </ListRow>
    })}
  </ListGroup>
}
