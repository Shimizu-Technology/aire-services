import { describe, expect, it } from 'vitest'
import {
  currentPayPeriod,
  formatPayPeriod,
  isSamePayPeriod,
  nextPayPeriod,
  parsePayPeriodStart,
  payPeriodContaining,
  payPeriodDays,
  payPeriodIncludes,
  previousPayPeriod,
  shiftPayPeriod,
  todayInGuam,
} from './payPeriods'

describe('pay periods', () => {
  it('splits each month at the 15th', () => {
    expect(payPeriodContaining('2026-11-01')).toEqual({ start: '2026-11-01', end: '2026-11-15' })
    expect(payPeriodContaining('2026-11-15')).toEqual({ start: '2026-11-01', end: '2026-11-15' })
    expect(payPeriodContaining('2026-11-16')).toEqual({ start: '2026-11-16', end: '2026-11-30' })
    expect(payPeriodContaining('2026-12-31')).toEqual({ start: '2026-12-16', end: '2026-12-31' })
  })

  it('ends February on the 28th, or the 29th in a leap year', () => {
    expect(payPeriodContaining('2027-02-20')).toEqual({ start: '2027-02-16', end: '2027-02-28' })
    expect(payPeriodContaining('2028-02-29')).toEqual({ start: '2028-02-16', end: '2028-02-29' })
    expect(payPeriodContaining('2100-02-28').end).toBe('2100-02-28')
    expect(payPeriodContaining('2000-02-29').end).toBe('2000-02-29')
    expect(() => payPeriodContaining('2027-02-29')).toThrow()
  })

  it('steps across month ends, February and the new year', () => {
    expect(nextPayPeriod({ start: '2026-11-16', end: '2026-11-30' })).toEqual({ start: '2026-12-01', end: '2026-12-15' })
    expect(nextPayPeriod({ start: '2026-12-16', end: '2026-12-31' })).toEqual({ start: '2027-01-01', end: '2027-01-15' })
    expect(previousPayPeriod({ start: '2027-01-01', end: '2027-01-15' })).toEqual({ start: '2026-12-16', end: '2026-12-31' })
    expect(nextPayPeriod({ start: '2028-02-01', end: '2028-02-15' })).toEqual({ start: '2028-02-16', end: '2028-02-29' })
    expect(nextPayPeriod({ start: '2028-02-16', end: '2028-02-29' })).toEqual({ start: '2028-03-01', end: '2028-03-15' })
    expect(previousPayPeriod({ start: '2027-03-01', end: '2027-03-15' })).toEqual({ start: '2027-02-16', end: '2027-02-28' })
    expect(previousPayPeriod({ start: '2026-08-01', end: '2026-08-15' })).toEqual({ start: '2026-07-16', end: '2026-07-31' })
    expect(shiftPayPeriod({ start: '2026-11-01', end: '2026-11-15' }, 24)).toEqual({ start: '2027-11-01', end: '2027-11-15' })
    expect(shiftPayPeriod({ start: '2026-11-01', end: '2026-11-15' }, -21)).toEqual({ start: '2025-12-16', end: '2025-12-31' })
  })

  it('uses Guam time, not the device time zone', () => {
    // 2026-11-15 14:30 UTC is already 00:30 on Nov 16 in Guam (UTC+10).
    const lateUtc = new Date('2026-11-15T14:30:00Z')
    expect(todayInGuam(lateUtc)).toBe('2026-11-16')
    expect(currentPayPeriod(lateUtc)).toEqual({ start: '2026-11-16', end: '2026-11-30' })
    expect(currentPayPeriod(new Date('2026-11-15T13:59:00Z'))).toEqual({ start: '2026-11-01', end: '2026-11-15' })
    // New Year's Eve in UTC is already New Year's Day in Guam.
    expect(currentPayPeriod(new Date('2026-12-31T15:00:00Z'))).toEqual({ start: '2027-01-01', end: '2027-01-15' })
  })

  it('lists every day of the period', () => {
    expect(payPeriodDays({ start: '2027-02-16', end: '2027-02-28' })).toHaveLength(13)
    expect(payPeriodDays({ start: '2028-02-16', end: '2028-02-29' }).at(-1)).toBe('2028-02-29')
    expect(payPeriodDays({ start: '2026-11-01', end: '2026-11-15' })[0]).toBe('2026-11-01')
    expect(payPeriodIncludes({ start: '2026-11-01', end: '2026-11-15' }, '2026-11-15')).toBe(true)
    expect(payPeriodIncludes({ start: '2026-11-01', end: '2026-11-15' }, '2026-11-16')).toBe(false)
  })

  it('reads only real period starts from the URL', () => {
    expect(parsePayPeriodStart('2026-10-16')).toEqual({ start: '2026-10-16', end: '2026-10-31' })
    expect(parsePayPeriodStart('2026-10-17')).toBeNull()
    expect(parsePayPeriodStart('2026-13-01')).toBeNull()
    expect(parsePayPeriodStart('nonsense')).toBeNull()
    expect(parsePayPeriodStart(null)).toBeNull()
  })

  it('labels periods plainly, with the year only when it differs', () => {
    const now = new Date('2026-11-11T00:00:00Z')
    expect(formatPayPeriod({ start: '2026-11-01', end: '2026-11-15' }, { now })).toBe('Nov 1–15')
    expect(formatPayPeriod({ start: '2026-10-16', end: '2026-10-31' }, { now })).toBe('Oct 16–31')
    expect(formatPayPeriod({ start: '2025-12-16', end: '2025-12-31' }, { now })).toBe('Dec 16–31, 2025')
    expect(formatPayPeriod({ start: '2028-02-16', end: '2028-02-29' }, { now, year: 'always' })).toBe('Feb 16–29, 2028')
    expect(isSamePayPeriod(payPeriodContaining('2026-11-03'), { start: '2026-11-01', end: '2026-11-15' })).toBe(true)
  })
})
