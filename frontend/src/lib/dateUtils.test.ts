import { describe, expect, it } from 'vitest'
import { addDateDays, businessDateISO, businessWeekStart, formatBusinessTime, formatDateOnly } from './dateUtils'

describe('Guam business dates on any device timezone', () => {
  it.each([
    ['2026-10-24T13:59:59Z', '2026-10-24', '2026-10-18'],
    ['2026-10-24T14:30:00Z', '2026-10-25', '2026-10-25'],
    ['2026-10-31T14:30:00Z', '2026-11-01', '2026-11-01'],
    ['2026-12-31T14:30:00Z', '2027-01-01', '2026-12-27'],
  ])('uses Guam date and Sunday week at %s', (instant, today, week) => {
    expect(businessDateISO(new Date(instant))).toBe(today)
    expect(businessWeekStart(today)).toBe(week)
  })

  it.each([
    ['2026-10-31', 1, '2026-11-01'],
    ['2026-11-01', -1, '2026-10-31'],
    ['2026-12-31', 1, '2027-01-01'],
    ['2028-02-28', 1, '2028-02-29'],
    ['2026-03-08', 7, '2026-03-15'],
    ['2026-11-01', 7, '2026-11-08'],
  ])('navigates date-only %s by %i days', (date, days, result) => {
    expect(addDateDays(date, days)).toBe(result)
    expect(addDateDays(result, -days)).toBe(date)
  })

  it('formats date-only calendar labels without shifting them', () => {
    expect(formatDateOnly('2026-11-01', { weekday: 'long', month: 'long', day: 'numeric' })).toBe('Sunday, November 1')
  })

  it('displays clock instants in Guam', () => {
    expect(formatBusinessTime('2026-10-24T22:00:00Z')).toBe('8:00 AM')
  })
})
