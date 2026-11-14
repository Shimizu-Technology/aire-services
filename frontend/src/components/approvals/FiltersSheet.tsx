import { useState } from 'react'
import { parsePayPeriodStart } from '../../lib/payPeriods'
import type { TimeCategory } from '../../lib/api'
import { Button, Field, Input, Select, Sheet } from '../ui'
export default function FiltersSheet({
  query,
  categories,
  people,
  onApply,
  onClose,
}: {
  query: URLSearchParams
  categories: TimeCategory[]
  people: { id: number; name: string }[]
  onApply: (query: URLSearchParams) => void
  onClose: () => void
}) {
  const [draft, setDraft] = useState(() => {
    const next = new URLSearchParams(query)
    const period = parsePayPeriodStart(next.get('period'))
    if (period) {
      if (!next.has('start_date')) next.set('start_date', period.start)
      if (!next.has('end_date')) next.set('end_date', period.end)
    }
    next.delete('period')
    return next
  })
  const update = (key: string, value: string) =>
    setDraft((current) => {
      const next = new URLSearchParams(current)
      if (value) next.set(key, value)
      else next.delete(key)
      return next
    })
  const dateKeys = ['date', 'through_date', 'since_date', 'start_date', 'end_date']
  const [dateMode, setDateMode] = useState(() =>
    query.has('date')
      ? 'date'
      : query.has('through_date')
        ? 'through_date'
        : query.has('since_date')
          ? 'since_date'
          : query.has('start_date') || query.has('period')
            ? 'range'
            : 'all',
  )
  const invalid = Boolean(
    draft.get('start_date') &&
      draft.get('end_date') &&
      draft.get('start_date')! > draft.get('end_date')!,
  )
  const select = (label: string, key: string, options: [string, string][]) => (
    <Field label={label}>
      <Select
        value={draft.get(key) || ''}
        onChange={(event) => update(key, event.target.value)}
      >
        {options.map(([value, text]) => (
          <option key={value} value={value}>
            {text}
          </option>
        ))}
      </Select>
    </Field>
  )
  const clearFilters = () => {
    const next = new URLSearchParams(query)
    const keys = [
      ...dateKeys,
      'period',
      'user_id',
      'time_category_id',
      'approval_type',
      'entry_method',
      'clock_source',
      'sort',
      'direction',
    ]
    keys.forEach((key) => next.delete(key))
    onApply(next)
  }
  const changeDateMode = (mode: string) => {
    setDateMode(mode)
    const next = new URLSearchParams(draft)
    const keys = [...dateKeys, 'period']
    keys.forEach((key) => next.delete(key))
    setDraft(next)
  }
  return (
    <Sheet
      open
      title="Filters"
      onClose={onClose}
      footer={
        <div className="flex justify-between gap-3">
          <Button variant="ghost" onClick={clearFilters}>
            Clear filters
          </Button>
          <Button disabled={invalid} onClick={() => onApply(draft)}>
            Apply filters
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <Field label="Date range">
          <Select value={dateMode} onChange={(event) => changeDateMode(event.target.value)}>
            <option value="all">All dates</option>
            <option value="date">On a date</option>
            <option value="through_date">Through a date</option>
            <option value="since_date">Since a date</option>
            <option value="range">Date range</option>
          </Select>
        </Field>
        {(dateMode === 'range'
          ? ['start_date', 'end_date']
          : dateMode === 'all'
            ? []
            : [dateMode]
        ).map((key) => (
          <Field
            key={key}
            label={
              key === 'end_date' ? 'End date' : key === 'start_date' ? 'Start date' : 'Date'
            }
          >
            <Input
              type="date"
              value={draft.get(key) || ''}
              onChange={(event) => update(key, event.target.value)}
            />
          </Field>
        ))}
        {invalid && (
          <p role="alert" className="text-body-sm text-danger">
            End date must be on or after start date.
          </p>
        )}
        {select('Person', 'user_id', [
          ['', 'Everyone'],
          ...people.map((person) => [String(person.id), person.name] as [string, string]),
        ])}
        {select('Category', 'time_category_id', [
          ['', 'All categories'],
          ...categories.map(
            (category) => [String(category.id), category.name] as [string, string],
          ),
        ])}
        {select('Review type', 'approval_type', [
          ['', 'All review types'],
          ['time_entry', 'Time entry'],
          ['overtime', 'Overtime'],
          ['both', 'Time and overtime'],
        ])}
        {select('Method', 'entry_method', [
          ['', 'Clock and manual'],
          ['clock', 'Clock'],
          ['manual', 'Manual'],
        ])}
        {select('Source', 'clock_source', [
          ['', 'All sources'],
          ['kiosk', 'Kiosk'],
          ['mobile', 'Mobile'],
          ['admin', 'Admin'],
          ['legacy', 'Legacy'],
        ])}
        {select('Sort', 'sort', [
          ['work_date', 'Work date'],
          ['created_at', 'Submitted time'],
          ['employee', 'Person'],
          ['hours', 'Hours'],
          ['approval_type', 'Review type'],
          ['category', 'Category'],
        ])}
        {select('Direction', 'direction', [
          ['asc', 'Oldest / A–Z / low first'],
          ['desc', 'Newest / Z–A / high first'],
        ])}
      </div>
    </Sheet>
  )
}
