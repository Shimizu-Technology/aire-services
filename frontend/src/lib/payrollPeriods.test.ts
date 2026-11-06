import type { PayrollBatchListItem, PayrollCutoffResponse } from './api'
import { describe, expect, it } from 'vitest'

import {
  currentPayrollPeriod,
  formatPayrollPeriod,
  greatestPayrollEndDate,
  isIsoDate,
  payrollPeriodFromSearchParams,
  payrollPreparationPeriod,
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

  it('finds the greatest finalized boundary regardless of finalization order', () => {
    expect(greatestPayrollEndDate([
      { end_date: '2026-08-15' },
      { end_date: '2026-07-31' },
      { end_date: '2026-08-31' },
    ])).toBe('2026-08-31')
    expect(greatestPayrollEndDate([])).toBeNull()
  })
})


describe('preparation selection is separate from reminders', () => {
  const current = { start: '2026-12-01', end: '2026-12-15' }
  const old = { id: 1, start_date: '2026-10-16', end_date: '2026-10-31' }
  const upcoming = { id: 2, start_date: '2026-11-01', end_date: '2026-11-15' }
  const batch = (purpose: 'regular' | 'supplemental', status = 'committed', period = old) => ({ ...period, id: 'batch', purpose, finalized_at: '2026-12-01T00:00:00Z', processing: { status } }) as PayrollBatchListItem
  const notice = (extra: object) => ({ cutoff: { period: old, stage: 'none' }, ...extra }) as PayrollCutoffResponse
  it('uses the earliest preparation publication before the reminder window', () => {
    expect(payrollPreparationPeriod(notice({ preparation_period: upcoming }), [batch('regular', 'payment_issued')], current)).toEqual({ start: upcoming.start_date, end: upcoming.end_date })
  })
  it('ignores stale batches, preparation and failure attention while paused', () => {
    expect(payrollPreparationPeriod(notice({ connected_payroll: { enabled: false }, preparation_period: upcoming, attention: { period: old } }), [batch('regular')], current)).toEqual(current)
  })
  it('does not use the reminder period as preparation', () => {
    expect(payrollPreparationPeriod(notice({}), [], current)).toEqual(current)
  })
  it('ignores a recently finalized supplemental batch and uses unfinished regular work', () => {
    expect(payrollPreparationPeriod(undefined, [batch('supplemental'), { ...batch('regular', 'imported', upcoming), finalized_at: '2026-11-20T00:00:00Z' }], current)).toEqual({ start: upcoming.start_date, end: upcoming.end_date })
    expect(payrollPreparationPeriod(undefined, [batch('supplemental')], current)).toEqual(current)
  })
})
