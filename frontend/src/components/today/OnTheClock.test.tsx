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

  it('takes breaks out of the hours', () => {
    render(<OnTheClock workers={[worker({ total_break_minutes: 30 })]} now={NOW} />)
    expect(screen.getByRole('listitem')).toHaveTextContent('5.7h')
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
