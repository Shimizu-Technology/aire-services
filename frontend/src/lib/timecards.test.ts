import { describe, expect, it } from 'vitest'
import type { UserSummary, WorkerStatus } from './api'
import type { TimecardSummaryEmployee } from './api/timecards'
import { buildPeopleRows, clockOutDate, manualShiftHours, previewClockOut, shortClock } from './timecards'

const NOW = new Date('2026-11-12T09:00:00+10:00')
const openClock = (clockInAt: string, overrides: Partial<Parameters<typeof previewClockOut>[0]> = {}) => ({
  clock_in_at: clockInAt, start_time: null, work_date: clockInAt.slice(0, 10), break_minutes: null, breaks: [], ...overrides,
})

describe('clockOutDate (the API normalisation, client side)', () => {
  it('puts a 10:30 PM to 6:30 AM shift’s clock-out on the next morning', () => {
    expect(clockOutDate('2026-11-10T22:30:00+10:00', '06:30')).toBe('2026-11-11')
  })

  it('keeps a later time on the clock-in day', () => {
    expect(clockOutDate('2026-11-10T07:02:00+10:00', '15:30')).toBe('2026-11-10')
  })

  it('treats the same minute as the next day, like the API', () => {
    expect(clockOutDate('2026-11-10T07:00:00+10:00', '07:00')).toBe('2026-11-11')
  })

  it('reads the clock-in in Guam, whatever its offset', () => {
    // 12:30 UTC is 10:30 PM in Guam.
    expect(clockOutDate('2026-11-10T12:30:00Z', '06:30')).toBe('2026-11-11')
  })
})

describe('previewClockOut', () => {
  it('shows 8.0h for the overnight shift before it is saved', () => {
    expect(previewClockOut(openClock('2026-11-10T22:30:00+10:00'), '06:30', NOW)).toEqual({ stopDate: '2026-11-11', breakMinutes: 0, hours: 8, problem: null })
  })

  it('takes recorded breaks off, ending an open break at clock-out', () => {
    const entry = openClock('2026-11-10T07:00:00+10:00', {
      breaks: [
        { id: 1, start_time: '2026-11-10T11:00:00+10:00', end_time: '2026-11-10T11:30:00+10:00', duration_minutes: 30, active: false },
        { id: 2, start_time: '2026-11-10T15:00:00+10:00', end_time: null, duration_minutes: null, active: true },
      ],
    })
    expect(previewClockOut(entry, '15:30', NOW)).toMatchObject({ stopDate: '2026-11-10', breakMinutes: 60, hours: 7.5, problem: null })
  })

  it('refuses a clock-out in the future', () => {
    expect(previewClockOut(openClock('2026-11-12T07:00:00+10:00'), '15:00', NOW)?.problem).toMatch(/future/)
  })

  it('needs a complete time', () => {
    expect(previewClockOut(openClock('2026-11-10T07:00:00+10:00'), '', NOW)).toBeNull()
  })
})

describe('manualShiftHours', () => {
  it('counts an overnight shift the way the API does', () => {
    expect(manualShiftHours('22:30', '06:30', null)).toBe(8)
    expect(manualShiftHours('07:00', '15:30', 30)).toBe(8)
    expect(manualShiftHours('07:00', '07:00', null)).toBe(0)
  })
})

it('shortens clock times', () => {
  expect(shortClock('7:02 AM')).toBe('7:02a')
  expect(shortClock('3:38 PM')).toBe('3:38p')
})

describe('buildPeopleRows', () => {
  const user = (id: number, name: string, extra: Partial<UserSummary> = {}): UserSummary => ({
    id, email: null, first_name: name.split(' ')[0], last_name: name.split(' ')[1] ?? null, display_name: name, full_name: name,
    role: 'employee', is_active: true, employment_status: 'active', approval_group_labels: ['CFI'], time_category_ids: [3], ...extra,
  })
  const summaryRow = (id: number, hours: number, issues: Partial<TimecardSummaryEmployee['issues']> = {}) => ({
    id, total_hours: hours, entries_count: hours > 0 ? 1 : 0,
    issues: { pending_count: 0, denied_count: 0, pending_overtime_count: 0, denied_overtime_count: 0, open_clock_count: 0, uncategorized_count: 0, ...issues },
  }) as TimecardSummaryEmployee
  const worker = (id: number, status: WorkerStatus['status'], openSince: string | null = null) => ({ user: { id }, status, open_since_work_date: openSince }) as WorkerStatus

  it('flags a forgotten clock, waiting time and waiting overtime, not someone on the clock today', () => {
    const rows = buildPeopleRows(
      [user(1, 'Caleb Perez'), user(2, 'Ethan Cruz'), user(3, 'Grace Torres'), user(4, 'Jun Santos'), user(5, 'Kai Blas')],
      [summaryRow(1, 43.2, { open_clock_count: 1 }), summaryRow(2, 69, { pending_overtime_count: 1 }), summaryRow(3, 76.1), summaryRow(4, 70.2, { pending_count: 2 }), summaryRow(5, 66.5)],
      [worker(1, 'clocked_in', '2026-11-10'), worker(3, 'clocked_in')],
      '2026-11-12',
    )
    expect(rows.map(row => [row.name, row.needsLook, row.openClock])).toEqual([
      ['Caleb Perez', true, 'stale'], ['Ethan Cruz', true, null], ['Grace Torres', false, 'live'], ['Jun Santos', true, null], ['Kai Blas', false, null],
    ])
    expect(rows[0]).toMatchObject({ approvedHours: 43.2, openSince: '2026-11-10', groups: ['CFI'] })
  })

  it('leaves out former staff with nothing this period and people who don’t track time', () => {
    const rows = buildPeopleRows(
      [user(1, 'Caleb Perez'), user(2, 'Old Timer', { employment_status: 'terminated' }), user(3, 'Leon Owner', { role: 'owner' })],
      [summaryRow(1, 8), summaryRow(2, 0)],
      [],
      '2026-11-12',
    )
    expect(rows.map(row => row.name)).toEqual(['Caleb Perez'])
  })

  it('lists everyone current without hours when the summary is unavailable', () => {
    const rows = buildPeopleRows([user(1, 'Caleb Perez'), user(2, 'Old Timer', { employment_status: 'terminated' })], null, [], '2026-11-12')
    expect(rows).toEqual([expect.objectContaining({ name: 'Caleb Perez', approvedHours: null })])
  })
})
