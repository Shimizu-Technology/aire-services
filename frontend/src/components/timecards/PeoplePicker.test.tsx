import '@testing-library/jest-dom'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { TimecardPersonRow } from '../../lib/timecards'
import { PeoplePicker } from './PeoplePicker'

const row = (id: number, name: string, extra: Partial<TimecardPersonRow> = {}): TimecardPersonRow => ({
  id, name, firstName: name.split(' ')[0], groups: ['CFI'], employmentStatus: 'active', terminationEffectiveOn: null, timeCategoryIds: [],
  workedHours: 40, waitingCount: 0, overtimeWaitingCount: 0, openClock: null, openSince: null, needsLook: false, ...extra,
})

const PEOPLE = [
  row(1, 'Caleb Perez', { groups: ['Ops / Maintenance'], openClock: 'stale', needsLook: true }),
  row(2, 'Ethan Cruz', { overtimeWaitingCount: 1, needsLook: true }),
  row(3, 'Grace Torres', { openClock: 'live' }),
  row(4, 'Jun Santos', { groups: ['Ops / Maintenance'], waitingCount: 2, needsLook: true }),
  row(5, 'Isabella Tenorio'),
]

function renderPicker(filter: string | null, people = PEOPLE) {
  const onFilterChange = vi.fn()
  const onSelect = vi.fn()
  render(<PeoplePicker people={people} selectedId={null} onSelect={onSelect} filter={filter} onFilterChange={onFilterChange} />)
  const names = () => within(screen.getByRole('list', { name: 'People' })).getAllByRole('group').map(item => item.querySelector('p')?.textContent)
  return { onFilterChange, onSelect, names }
}

describe('PeoplePicker', () => {
  it('starts on People to check, with one plain state per person', () => {
    const { names } = renderPicker(null)
    expect(screen.getByRole('button', { name: /People to check/ })).toHaveAttribute('aria-pressed', 'true')
    expect(names()).toEqual(['Caleb Perez', 'Ethan Cruz', 'Jun Santos'])
    expect(screen.getByText('Still clocked in')).toBeInTheDocument()
    expect(screen.getByText('Overtime waiting')).toBeInTheDocument()
    expect(screen.getByText('2 waiting')).toBeInTheDocument()
  })

  it('starts on everyone when nobody needs a look', () => {
    const { names } = renderPicker(null, [row(3, 'Grace Torres', { openClock: 'live' }), row(5, 'Isabella Tenorio')])
    expect(screen.getByRole('button', { name: /People to check/ })).toHaveAttribute('aria-pressed', 'false')
    expect(names()).toEqual(['Grace Torres', 'Isabella Tenorio'])
    expect(screen.getByText('On the clock')).toBeInTheDocument()
  })

  it('filters by department, and a chip turns off with a second tap', () => {
    const { names, onFilterChange } = renderPicker('CFI')
    expect(names()).toEqual(['Ethan Cruz', 'Grace Torres', 'Isabella Tenorio'])
    fireEvent.click(screen.getByRole('button', { name: 'CFI' }))
    expect(onFilterChange).toHaveBeenCalledWith('all')
    fireEvent.click(screen.getByRole('button', { name: 'Ops / Maintenance' }))
    expect(onFilterChange).toHaveBeenCalledWith('Ops / Maintenance')
  })

  it('opens a person from their row', () => {
    const { onSelect } = renderPicker(null)
    fireEvent.click(screen.getByText('Jun Santos'))
    expect(onSelect).toHaveBeenCalledWith(PEOPLE[3])
  })
})
