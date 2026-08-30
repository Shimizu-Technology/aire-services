import { describe, expect, it } from 'vitest'

import {
  currentPayrollPeriod,
  formatPayrollPeriod,
  isIsoDate,
  payrollPeriodFromSearchParams,
  withPayrollPeriod,
} from './payrollPeriods'

describe('payroll period utilities', () => {
  it('uses the Guam calendar date for semi-monthly periods', () => {
    expect(currentPayrollPeriod(new Date('2026-08-15T14:30:00Z'))).toEqual({
      start: '2026-08-16',
      end: '2026-08-31',
    })
  })

  it('rejects malformed and impossible dates', () => {
    expect(isIsoDate('2026-08-31')).toBe(true)
    expect(isIsoDate('2026-02-30')).toBe(false)
    expect(isIsoDate('08/31/2026')).toBe(false)
  })

  it('reads a valid linked period and falls back when it is invalid', () => {
    const fallback = { start: '2026-08-16', end: '2026-08-31' }
    expect(payrollPeriodFromSearchParams(new URLSearchParams('start_date=2026-08-01&end_date=2026-08-15'), fallback)).toEqual({
      start: '2026-08-01',
      end: '2026-08-15',
    })
    expect(payrollPeriodFromSearchParams(new URLSearchParams('start_date=2026-08-31&end_date=2026-08-01'), fallback)).toEqual(fallback)
  })

  it('formats labels and date-preserving links', () => {
    const period = { start: '2026-08-16', end: '2026-08-31' }
    expect(formatPayrollPeriod(period)).toBe('Aug 16, 2026–Aug 31, 2026')
    expect(withPayrollPeriod('/admin/time', period, { tab: 'approvals' })).toBe('/admin/time?start_date=2026-08-16&end_date=2026-08-31&tab=approvals')
  })
})
