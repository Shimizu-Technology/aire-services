import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NOW, attention, caleb, ethan, period as attentionPeriod } from '../../test/fixtures/today'
import { carried, lockedBatch, paidPeriod, preview } from '../../test/fixtures/payPeriod'
import { carriedDestination, carriedHours, checklistEntries, periodFacts, personRows, type ChecklistInput, type PeriodWaiting } from './payPeriodModel'

const range = { start: '2026-11-01', end: '2026-11-15' }

beforeEach(() => { vi.useFakeTimers({ now: new Date(NOW), toFake: ['Date'] }) })
afterEach(() => { vi.useRealTimers() })

const byKey = (entries: ReturnType<typeof checklistEntries>) => Object.fromEntries(entries.map(entry => [entry.key, entry]))

// Waiting on Nov 1–15's dates, as pending approvals reports it.
const waiting = (overrides: Partial<PeriodWaiting> = {}): PeriodWaiting => ({
  count: 31, hours: 276.06, overtime: { count: 1, hours: 6, people: ['Ethan Cruz'] }, ...overrides,
})
const today = '2026-11-11'
const input = (overrides: Partial<ChecklistInput> = {}): ChecklistInput => ({
  range, today, attention: attention(), preview: preview(), waiting: waiting(), previousStart: '2026-10-16', ...overrides,
})
/** One included Nov line, and Jun's carried-in Oct 30 line, with no resolvable work category. */
const uncategorizedCarryIn = () => {
  const base = preview()
  const employees = base.employees.map(employee => employee.display_name === 'Jun Santos'
    ? { ...employee, adjustments: employee.adjustments.map(line => ({ ...line, category: null, source_category_id: null })) }
    : employee)
  return preview({ employees, issues: { ...base.issues, missing_category_count: 1 } })
}

describe('Before it locks', () => {
  it('lists every open item with the exact filtered view it needs', () => {
    const entries = checklistEntries(input({ preview: uncategorizedCarryIn() }))
    expect(entries.map(entry => [entry.key, entry.status, entry.text, entry.meta ?? null, entry.action?.to ?? null])).toEqual([
      ['approvals', 'todo', '31 shifts waiting for approval', '276.1h', '/admin/approvals?start_date=2026-11-01&end_date=2026-11-15'],
      ['open_clocks', 'todo', '1 person still clocked in from an earlier day', caleb.full_name, '/admin/timecards?entry_id=812&date=2026-11-10&user_id=7'],
      ['overtime', 'todo', '6h overtime waiting', ethan.full_name, '/admin/approvals?start_date=2026-11-01&end_date=2026-11-15&approval_type=overtime'],
      ['missing_category', 'todo', '1 shift has no work category', null, '/admin/timecards?entry_id=640'],
      ['late_hours', 'info', '1 shift approved after the Oct 16–31 lock goes into this payroll', '8.9h', null],
    ])
  })

  it('reads all clear when nothing is waiting', () => {
    const clear = attention({ items: [], period: { ...attentionPeriod, waiting_count: 0, waiting_hours: 0 } })
    const entries = checklistEntries(input({ attention: clear, preview: preview({ employees: [], exclusions: [] }), waiting: waiting({ count: 0, hours: 0, overtime: { count: 0, hours: 0, people: [] } }) }))
    expect(entries.map(entry => [entry.status, entry.text])).toEqual([
      ['done', 'No shifts waiting for approval'],
      ['done', 'Nobody is still clocked in from an earlier day'],
      ['done', 'No overtime waiting'],
      ['done', 'Every shift has a work category'],
      ['done', 'No late hours from Oct 16–31 to carry in'],
    ])
    expect(entries.every(entry => !entry.action)).toBe(true)
  })

  // Codex finding 3: Today's list only covers this period's own shifts.
  it("counts a carried-in shift with no work category even when Today's list has none", () => {
    const entries = byKey(checklistEntries(input({ attention: attention({ items: [] }), preview: uncategorizedCarryIn() })))
    expect(entries.missing_category).toMatchObject({ status: 'todo', text: '1 shift has no work category', action: { to: '/admin/timecards?entry_id=640' } })
  })

  // Codex finding 5: overtime from earlier weeks isn't this period's.
  it("shows this period's waiting overtime, not the person's whole backlog", () => {
    const items = attention().items.map(item => item.type === 'overtime_waiting'
      ? { ...item, hours: 10, people: [{ ...item.people[0], hours: 10, entry_count: 2, week_starts: ['2026-10-26', '2026-11-02'] }] }
      : item)
    const entries = byKey(checklistEntries(input({ attention: attention({ items }), waiting: waiting({ overtime: { count: 1, hours: 2, people: ['Ethan Cruz'] } }) })))
    expect(entries.overtime).toMatchObject({ text: '2h overtime waiting', meta: 'Ethan Cruz' })
  })

  it('counts overtime shifts without hours when the list was cut short', () => {
    const entries = byKey(checklistEntries(input({ waiting: waiting({ overtime: { count: 3, hours: null, people: ['Ethan Cruz'] } }) })))
    expect(entries.overtime.text).toBe('3 shifts with overtime waiting')
  })

  // Codex finding 6: an approved shift with overtime pending still waits.
  it('counts waiting overtime as waiting for approval on a period Today does not cover', () => {
    const other = attention({ period: { ...attentionPeriod, start_date: '2026-11-16', end_date: '2026-11-30' } })
    const quiet = preview({ issues: { ...preview().issues, pending_approval_count: 0 } })
    const entries = byKey(checklistEntries(input({ attention: other, preview: quiet, waiting: waiting({ count: 1, hours: 10, overtime: { count: 1, hours: 2, people: ['Ethan Cruz'] } }) })))
    expect(entries.approvals).toMatchObject({ status: 'todo', text: '1 shift waiting for approval', meta: '10h' })
    expect(entries.overtime).toMatchObject({ status: 'todo', text: '2h overtime waiting' })
  })

  it("uses the preview's earlier-day clocks for a period Today doesn't cover", () => {
    const other = attention({ period: { ...attentionPeriod, start_date: '2026-11-16', end_date: '2026-11-30' } })
    const todayClock = { ...preview().exclusions[0], source_time_entry_id: '990', source_user_id: '30', display_name: 'Ana Today', original_work_date: today }
    const entries = byKey(checklistEntries(input({ attention: other, preview: preview({ exclusions: [...preview().exclusions, todayClock] }) })))
    expect(entries.open_clocks).toMatchObject({ status: 'todo', meta: 'Caleb Perez', action: { to: '/admin/timecards?entry_id=812&date=2026-11-10&user_id=7' } })
    expect(entries.late_hours.text).toBe('1 shift approved after the Oct 16–31 lock goes into this payroll')
  })

  it('shows nothing until a source has loaded', () => {
    expect(checklistEntries(input({ attention: null, preview: null, waiting: null }))).toEqual([])
  })

  it('names three people, then counts the rest', () => {
    const entries = byKey(checklistEntries(input({ waiting: waiting({ overtime: { count: 4, hours: 4, people: ['Ana', 'Ben', 'Cy', 'Di'] } }) })))
    expect(entries.overtime.meta).toBe('Ana, Ben, Cy and 1 more')
  })
})

describe('What goes to payroll', () => {
  it('groups approved and waiting hours by person, including people with only waiting time', () => {
    const rows = personRows(preview({ exclusions: [...preview().exclusions, { ...preview().exclusions[0], source_time_entry_id: '990', source_user_id: '30', display_name: 'Ana Waiting', reason: 'pending_approval', held_total_hours: 4 }] }))
    expect(rows.map(row => [row.name, row.regular, row.overtime, row.waiting, row.stillClockedIn, row.overtimeWaiting])).toEqual([
      ['Ana Waiting', 0, 0, 4, false, 0],
      ['Caleb Perez', 43.2, 0, 9.1, true, 0],
      ['Ethan Cruz', 40, 0, 10, false, 6],
      ['Jun Santos', 8.9, 0, 0, false, 0],
    ])
  })

  it('reads a frozen batch the same way', () => {
    expect(personRows(lockedBatch().payload).map(row => [row.name, row.regular, row.overtime, row.waiting])).toEqual([['Caleb Perez', 76, 4, 0], ['Jun Santos', 0, 0, 8.9]])
  })
})

describe('earlier periods and carried hours', () => {
  it('sums up a paid period', () => {
    expect(periodFacts(paidPeriod())).toBe('Locked Nov 2 · paid Nov 10 · 30 people · 1,962.4h')
  })

  it.each([
    [carried(), { label: 'Next payroll' }],
    [carried({ included_batch: { id: 'B', start_date: '2026-11-01', end_date: '2026-11-15', processing: null } }), { label: 'In the Nov 1–15 payroll', to: '/admin/payroll/periods/2026-11-01' }],
    [carried({ status: 'awaiting_approval' }), { label: 'Waiting for approval' }],
    [carried({ status: 'not_payable' }), { label: 'Closed without pay' }],
    [carried({ status: 'payment_issued', completion: 'paid' }), { label: 'Paid' }],
    [carried({ status: 'needs_review' }), { label: 'Payment follow-up' }],
    // Codex finding 2: a reported payment counts only once the backend verified it.
    [carried({ status: 'payment_issued', completion: null }), { label: 'Payment follow-up' }],
    [carried({ status: 'committed', completion: null, payroll_lifecycle: { status: 'committed', label: 'x', accounting_only: true, settlements: [] } }), { label: 'Payment follow-up' }],
    [carried({ status: 'committed', completion: 'accounting_recorded' }), { label: 'Correction to an earlier payroll' }],
  ])('says where a carried shift went (%#)', (item, destination) => {
    expect(carriedDestination(item)).toEqual(destination)
  })

  // Codex finding 7: only the held part was carried.
  it('reports the carried part of a shift, and the whole shift only when bigger', () => {
    expect(carriedHours(carried({ held_total_hours: 2, current_total_hours: 10 }))).toEqual({ carried: 2, shift: 10 })
    expect(carriedHours(carried({ held_total_hours: 8.9, current_total_hours: 8.9 }))).toEqual({ carried: 8.9, shift: null })
  })
})
