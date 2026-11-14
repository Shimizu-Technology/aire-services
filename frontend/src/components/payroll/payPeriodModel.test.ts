import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NOW, attention, caleb, ethan, period as attentionPeriod } from '../../test/fixtures/today'
import { carried, lockedBatch, paidPeriod, preview } from '../../test/fixtures/payPeriod'
import { carriedDestination, checklistEntries, periodFacts, personRows } from './payPeriodModel'

const range = { start: '2026-11-01', end: '2026-11-15' }

beforeEach(() => { vi.useFakeTimers({ now: new Date(NOW), toFake: ['Date'] }) })
afterEach(() => { vi.useRealTimers() })

const byKey = (entries: ReturnType<typeof checklistEntries>) => Object.fromEntries(entries.map(entry => [entry.key, entry]))

describe('Before it locks', () => {
  it('lists every open item with the exact filtered view it needs', () => {
    const entries = checklistEntries({ range, attention: attention(), preview: preview(), previousStart: '2026-10-16' })
    expect(entries.map(entry => [entry.key, entry.status, entry.text, entry.meta ?? null, entry.action?.to ?? null])).toEqual([
      ['approvals', 'todo', '31 shifts waiting for approval', '276.1h', '/admin/approvals?start_date=2026-11-01&end_date=2026-11-15'],
      ['open_clocks', 'todo', '1 person still clocked in from an earlier day', caleb.full_name, '/admin/timecards?entry_id=812&date=2026-11-10&user_id=7'],
      ['overtime', 'todo', '6h overtime waiting', ethan.full_name, '/admin/approvals?start_date=2026-11-01&end_date=2026-11-15&approval_type=overtime'],
      ['missing_category', 'todo', '2 shifts have no work category', null, '/admin/timecards?entry_id=901'],
      ['late_hours', 'info', '1 shift approved after the Oct 16–31 lock goes into this payroll', '8.9h', null],
    ])
  })

  it('reads all clear when nothing is waiting', () => {
    const clear = attention({ items: [], period: { ...attentionPeriod, waiting_count: 0, waiting_hours: 0 } })
    const entries = checklistEntries({ range, attention: clear, preview: preview({ employees: [], exclusions: [] }), previousStart: '2026-10-16' })
    expect(entries.map(entry => [entry.status, entry.text])).toEqual([
      ['done', 'No shifts waiting for approval'],
      ['done', 'Nobody is still clocked in from an earlier day'],
      ['done', 'No overtime waiting'],
      ['done', 'Every shift has a work category'],
      ['done', 'No late hours from Oct 16–31 to carry in'],
    ])
    expect(entries.every(entry => !entry.action)).toBe(true)
  })

  it('leaves out overtime and open clocks from other pay periods', () => {
    const items = attention().items.map(item => {
      if (item.type === 'open_clock_earlier_day') return { ...item, work_date: '2026-10-30' }
      if (item.type === 'overtime_waiting') return { ...item, people: [{ ...item.people[0], week_starts: ['2026-10-19'] }] }
      return item
    })
    const entries = byKey(checklistEntries({ range, attention: attention({ items }), preview: null, previousStart: null }))
    expect(entries.open_clocks.status).toBe('done')
    expect(entries.overtime.status).toBe('done')
  })

  it('counts a week that starts in the last period but runs into this one', () => {
    const items = attention().items.map(item => item.type === 'overtime_waiting' ? { ...item, people: [{ ...item.people[0], week_starts: ['2026-10-26'] }] } : item)
    expect(byKey(checklistEntries({ range, attention: attention({ items }), preview: null, previousStart: null })).overtime.status).toBe('todo')
  })

  it('says how many shifts have overtime when the hours are not projected yet', () => {
    const items = attention().items.map(item => item.type === 'overtime_waiting' ? { ...item, hours: null, people: [{ ...item.people[0], hours: null, entry_count: 3 }] } : item)
    expect(byKey(checklistEntries({ range, attention: attention({ items }), preview: null, previousStart: null })).overtime.text).toBe('3 shifts with overtime waiting')
  })

  it("falls back to the preview's counts for a period Today doesn't cover", () => {
    const other = attention({ period: { ...attentionPeriod, start_date: '2026-11-16', end_date: '2026-11-30' } })
    const entries = byKey(checklistEntries({ range, attention: other, preview: preview({ issues: { ...preview().issues, pending_approval_count: 2, missing_category_count: 1 } }), previousStart: null }))
    expect(entries.approvals).toMatchObject({ status: 'todo', text: '2 shifts waiting for approval', meta: '10h' })
    expect(entries.open_clocks).toMatchObject({ status: 'todo', meta: 'Caleb Perez', action: { to: '/admin/timecards?entry_id=812&date=2026-11-10&user_id=7' } })
    expect(entries.overtime).toMatchObject({ status: 'todo', text: '6h overtime waiting', meta: 'Ethan Cruz' })
    expect(entries.missing_category).toMatchObject({ status: 'todo', action: { to: '/admin/reports?start_date=2026-11-01&end_date=2026-11-15&category_status=uncategorized' } })
    expect(entries.late_hours.text).toBe('1 shift approved after an earlier lock goes into this payroll')
  })

  it('shows nothing until a source has loaded', () => {
    expect(checklistEntries({ range, attention: null, preview: null, previousStart: null })).toEqual([])
  })

  it('names three people, then counts the rest', () => {
    const people = ['Ana', 'Ben', 'Cy', 'Di'].map((name, index) => ({ ...ethan, id: index, full_name: name, display_name: name, hours: 1, entry_count: 1, week_starts: ['2026-11-02'] }))
    const items = attention().items.map(item => item.type === 'overtime_waiting' ? { ...item, people } : item)
    expect(byKey(checklistEntries({ range, attention: attention({ items }), preview: null, previousStart: null })).overtime.meta).toBe('Ana, Ben, Cy and 1 more')
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
  ])('says where a carried shift went (%#)', (item, destination) => {
    expect(carriedDestination(item)).toEqual(destination)
  })
})
