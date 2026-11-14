import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { TimeEntry } from '../../lib/api'
import { DayRow } from './DayRow'

const shift = {
  id: 4, version: 1, work_date: '2026-11-06', start_time: '07:00', end_time: '18:30', formatted_start_time: '7:00 AM', formatted_end_time: '6:30 PM',
  hours: 11.5, break_minutes: 0, description: null, entry_method: 'clock', status: 'completed', admin_override: false, attendance_status: null,
  approval_status: 'approved', overtime_status: 'pending', clock_in_at: '2026-11-06T07:00:00+10:00', clock_out_at: '2026-11-06T18:30:00+10:00',
  approved_by: null, approved_at: null, approval_note: null, overtime_approved_by: null, overtime_approved_at: null, overtime_note: null,
  schedule: null, breaks: [], user: { id: 5, email: 'e@aire.test', display_name: 'Ethan', full_name: 'Ethan Cruz' }, time_category: { id: 1, name: 'Flight Instruction' },
} as unknown as TimeEntry

describe('DayRow', () => {
  it('never cuts off the shift time when it carries two pills; the pills get their own line on phones', () => {
    render(
      <DayRow
        date="2026-11-06"
        today="2026-11-14"
        items={[{ entry: shift, hours: 11.5, continuesFrom: null, partial: false }]}
        categories={[{ id: 1, name: 'Flight Instruction' }]}
        fixingEntryId={null}
        onFix={vi.fn()}
        onOpen={vi.fn()}
        onSaved={vi.fn()}
      />,
    )
    const time = screen.getByText('7:00a–6:30p')
    expect(time).toHaveClass('whitespace-nowrap')
    expect(time.className).not.toMatch(/truncate/)
    const pills = screen.getByText('Overtime waiting').closest('[class*="grid-area:pills"]')!
    expect(pills).toHaveTextContent('Overtime waitingApproved')
    // Phones: time and hours, then the detail, then the pills, each on its own line.
    expect(time.closest('[data-shift-layout]')!.className).toContain("[grid-template-areas:'time_hours'_'detail_detail'_'pills_pills']")
  })
})
