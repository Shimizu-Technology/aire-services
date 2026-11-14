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
      ['missing_category', 'todo', '2 shifts have no work category', null, '/admin/timecards?entry_id=640'],
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
      ['done', 'Every finished shift has a work category'],
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

  // Re-check 1: Today's list refreshes every minute; the preview every five.
  it("takes the larger category count, so a shift Today just flagged shows before the next preview", () => {
    const entries = byKey(checklistEntries(input({ preview: preview() })))
    expect(entries.missing_category).toMatchObject({ status: 'todo', text: '2 shifts have no work category', action: { to: '/admin/timecards?entry_id=901' } })
  })

  // Re-check 6: the done line names what was checked.
  it('says which shifts were checked for a work category', () => {
    const clear = attention({ items: [] })
    expect(byKey(checklistEntries(input({ attention: clear }))).missing_category.text).toBe('Every finished shift has a work category')
    const other = attention({ period: { ...attentionPeriod, start_date: '2026-11-16', end_date: '2026-11-30' } })
    expect(byKey(checklistEntries(input({ attention: other }))).missing_category.text).toBe('Every approved shift has a work category')
  })

  // Re-check 7: the Fix link opens a shift that pays hours, not a correction line.
  it('links Fix to the uncategorized shift that pays hours', () => {
    const base = uncategorizedCarryIn()
    const correction = { ...base.employees[0].adjustments[0], source_time_entry_id: '555', source_kind: 'correction' as const, category: null, total_hours: -2, regular_hours: -2 }
    const employees = base.employees.map((employee, index) => index === 0 ? { ...employee, adjustments: [correction, ...employee.adjustments] } : employee)
    const entries = byKey(checklistEntries(input({ attention: attention({ items: [] }), preview: { ...base, employees } })))
    expect(entries.missing_category.action?.to).toBe('/admin/timecards?entry_id=640')
  })

  it('counts overtime shifts without hours when the list was cut short', () => {
    const entries = byKey(checklistEntries(input({ waiting: waiting({ overtime: { count: 3, hours: null, people: ['Ethan Cruz'] } }) })))
    expect(entries.overtime.text).toBe('3 shifts with overtime to review')
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

  it('splits out overtime held from earlier periods', () => {
    const earlier = { ...preview().exclusions[1], source_time_entry_id: '880', original_work_date: '2026-10-29', held_total_hours: 12, held_regular_hours: 4, held_overtime_hours: 8 }
    const ethan = personRows(preview({ exclusions: [...preview().exclusions, earlier] })).find(row => row.name === 'Ethan Cruz')
    expect(ethan).toMatchObject({ overtimeWaiting: 14, overtimeWaitingEarlier: 8 })
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
    const ot = { exclusion_reason: 'overtime_approved_after_cutoff' }
    expect(carriedHours(carried({ ...ot, held_total_hours: 2, current_total_hours: 10 }))).toEqual({ carried: 2, shift: 10 })
    // Re-check 4: edited down after the lock, an overtime hold can't carry more than the shift now has.
    expect(carriedHours(carried({ ...ot, held_total_hours: 4, current_total_hours: 3 }))).toEqual({ carried: 3, shift: null })
    // A whole-shift hold carries the shift as it is now, edited up or down.
    expect(carriedHours(carried({ exclusion_reason: 'approved_after_cutoff', held_total_hours: 8.9, current_total_hours: 9.5 }))).toEqual({ carried: 9.5, shift: null })
    expect(carriedHours(carried({ exclusion_reason: 'pending_approval', held_total_hours: 8.9, current_total_hours: 6 }))).toEqual({ carried: 6, shift: null })
    expect(carriedHours(carried({ exclusion_reason: 'open_clock', held_total_hours: 0, current_total_hours: null }))).toEqual({ carried: 0, shift: null })
  })
})
