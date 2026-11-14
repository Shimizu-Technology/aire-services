import '@testing-library/jest-dom'
import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { worker } from '../../test/fixtures/today'
import { OnTheClock } from './OnTheClock'

const NOW = new Date('2026-11-11T19:41:00+10:00')

describe('OnTheClock', () => {
  it('lists who is clocked in with when, what and how long', () => {
    render(<OnTheClock workers={[worker()]} now={NOW} loadedAt={NOW} />)
    expect(screen.getByRole('heading', { name: /On the clock\s+· 1/ })).toBeInTheDocument()
    expect(screen.getByText('Updated 7:41 PM')).toBeInTheDocument()
    const row = screen.getByRole('listitem')
    expect(row).toHaveTextContent('Grace Torres')
    expect(row).toHaveTextContent('Since 1:30 PM · Flight Instruction')
    expect(row).toHaveTextContent('6.2h')
  })

  it('takes the open shift\'s breaks out of the hours', () => {
    const shift = worker().day_entries![0]
    render(<OnTheClock
      workers={[worker({ day_entries: [{ ...shift, breaks: [{ start_time: '2026-11-11T15:00:00+10:00', end_time: '2026-11-11T15:30:00+10:00', duration_minutes: 30, active: false }] }] })]}
      now={NOW}
    />)
    expect(screen.getByRole('listitem')).toHaveTextContent('5.7h')
  })

  it('counts a split day from the open shift, not the gap between shifts', () => {
    // Worked 07:00-09:00, then clocked in again at 13:00. It is 19:41.
    const split = worker({
      clock_in_at: '2026-11-11T07:00:00+10:00',
      total_break_minutes: 0,
      day_entries: [
        { id: 1, status: 'completed', clock_in_at: '2026-11-11T07:00:00+10:00', clock_out_at: '2026-11-11T09:00:00+10:00', hours: 2, time_category: { id: 3, name: 'Ground Operations' }, breaks: [] },
        { id: 2, status: 'clocked_in', clock_in_at: '2026-11-11T13:00:00+10:00', clock_out_at: null, hours: 0, time_category: { id: 4, name: 'Flight Instruction' }, breaks: [] },
      ],
    })
    render(<OnTheClock workers={[split]} now={NOW} />)
    const row = screen.getByRole('listitem')
    expect(row).toHaveTextContent('Since 1:00 PM · Flight Instruction')
    expect(row).toHaveTextContent('6.7h')
    expect(row).not.toHaveTextContent('Since 7:00 AM')
    expect(row).not.toHaveTextContent('12.7h')
  })

  it('takes a break in progress out of the open shift', () => {
    const shift = worker().day_entries![0]
    render(<OnTheClock
      workers={[worker({ status: 'on_break', active_break: true, day_entries: [{ ...shift, status: 'on_break', breaks: [{ start_time: '2026-11-11T19:11:00+10:00', end_time: null, duration_minutes: null, active: true }] }] })]}
      now={NOW}
    />)
    expect(screen.getByRole('listitem')).toHaveTextContent('5.7h')
    expect(screen.getByRole('listitem')).toHaveTextContent('On break')
  })

  it('puts a clock left open from an earlier day first, with an Earlier day pill and no hours', () => {
    const earlier = worker({ id: 7, name: 'Caleb Perez', clock_in_at: '2026-11-10T07:02:00+10:00', open_since_work_date: '2026-11-10', time_category: { id: 3, name: 'Ground Operations' } })
    render(<OnTheClock workers={[worker(), earlier]} now={NOW} />)
    const rows = screen.getAllByRole('listitem')
    expect(rows[0]).toHaveTextContent('Caleb Perez')
    expect(rows[0]).toHaveTextContent('Since Tue 7:02 AM · Ground Operations')
    expect(within(rows[0]).getByText('Earlier day').closest('[data-tone]')).toHaveAttribute('data-tone', 'needs-fix')
    expect(rows[0]).not.toHaveTextContent('h')
    expect(rows[1]).toHaveTextContent('Grace Torres')
  })

  it('marks a break and skips people who are clocked out', () => {
    render(<OnTheClock workers={[worker({ status: 'on_break' }), worker({ id: 20, name: 'Out Person', status: 'clocked_out' })]} now={NOW} />)
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(screen.getByRole('listitem')).toHaveTextContent('On break')
  })

  it('says when nobody is clocked in', () => {
    render(<OnTheClock workers={[]} now={NOW} />)
    expect(screen.getByText('Nobody is clocked in.')).toBeInTheDocument()
  })
})
