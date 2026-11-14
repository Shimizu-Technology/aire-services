import { describe, expect, it } from 'vitest'
import { employeeWorkspaceHref, linkedTimePeriod, personTab, safeAdminReturn } from './employeeWorkspace'

describe('employee investigation links', () => {
  it('retains the exact person, period, entry and filter context', () => {
    const url = new URL(employeeWorkspaceHref(7, { tab: 'hours', period: '2026-09-01', entry: '19', startDate: '2026-09-01', returnTo: '/admin/time?user_id=7&view=reports' }), 'https://local.invalid')
    expect(url.pathname).toBe('/admin/users/7')
    // Old keys are written as today's tab.
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ tab: 'time', period: '2026-09-01', entry: '19', return_to: '/admin/time?user_id=7&view=reports' })
  })
  it('rejects unsafe return targets and invalid employee identifiers', () => {
    for (const value of ['https://evil.invalid', '//evil.invalid', '/admin\\evil.invalid', '/administrator', '/admin\n']) expect(safeAdminReturn(value)).toBe('/admin/users')
    expect(employeeWorkspaceHref('7/../8')).toBe('/admin/users')
  })
  it('sends an Activity link to Overview at Recent activity', () => {
    expect(employeeWorkspaceHref(7, { tab: 'activity' })).toBe('/admin/users/7?tab=overview#activity')
  })
})

describe('person tabs', () => {
  it.each([
    ['hours', 'time'],
    ['schedule', 'time'],
    ['setup', 'access'],
    ['activity', 'overview'],
    ['overview', 'overview'],
    ['time', 'time'],
    ['pay', 'pay'],
    ['access', 'access'],
    ['employment', 'employment'],
    ['constructor', 'overview'],
    ['', 'overview'],
    [null, 'overview'],
  ])('maps %s to %s', (key, tab) => {
    expect(personTab(key)).toBe(tab)
  })
})

describe("the Time tab's linked period", () => {
  const period = (query: string) => linkedTimePeriod(new URLSearchParams(query))

  // Cornerstone builds `{ tab:, period:, entry: }.compact.to_query`: sorted keys, any of them missing.
  it.each([
    ['entry=19&period=2026-11-01&tab=hours', { start: '2026-11-01', end: '2026-11-15' }],
    ['period=2026-10-16&tab=hours', { start: '2026-10-16', end: '2026-10-31' }],
    ['entry=19&tab=hours', null],
    ['tab=hours', null],
  ])('reads %s', (query, expected) => {
    expect(period(query)).toEqual(expected)
  })

  it('takes a period that names any day of it', () => {
    expect(period('period=2026-02-20')).toEqual({ start: '2026-02-16', end: '2026-02-28' })
  })

  it("falls back to Payroll's start_date, and ignores nonsense", () => {
    expect(period('tab=hours&start_date=2026-09-03&end_date=2026-09-03')).toEqual({ start: '2026-09-01', end: '2026-09-15' })
    expect(period('period=2026-13-01')).toBeNull()
    expect(period('period=yesterday&start_date=bad')).toBeNull()
  })
})
