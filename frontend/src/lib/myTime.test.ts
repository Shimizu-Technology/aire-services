import { afterEach, describe, expect, it, vi } from 'vitest'
import { categories, clockStatus, shift } from '../test/employeeFixtures'
import {
  chooseLastCategory,
  LOCATION_TIMEOUT,
  needsClockOutConfirm,
  periodPaidDate,
  periodTotals,
  requestLocation,
  workedMilliseconds,
  withOvertimeHours,
} from './myTime'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('clock-out thresholds', () => {
  it.each([
    [59 * 60_000, true],
    [3_600_000, false],
    [12 * 3_600_000, false],
    [12 * 3_600_000 + 1, true],
  ])('checks %i milliseconds', (duration, confirm) => {
    expect(
      needsClockOutConfirm(
        '2026-11-14T00:00:00Z',
        Date.parse('2026-11-14T00:00:00Z') + duration,
      ),
    ).toBe(confirm)
  })
})

it('preselects the last clocked work, ignoring manual shifts and retired categories', () => {
  expect(
    chooseLastCategory(
      categories,
      [shift(), shift({ entry_method: 'manual', time_category: categories[0] })],
      1,
    ),
  ).toBe(2)
  expect(chooseLastCategory(categories, [], 2)).toBe(2)
  expect(chooseLastCategory(categories, [], 99)).toBe(1)
})

it('does not subtract earlier segment breaks twice after switching work', () => {
  const status = clockStatus({
    clocked_in: true,
    clock_in_at: '2026-11-14T10:00:00Z',
    break_minutes: 15,
    session: {
      original_clock_in_at: '2026-11-14T08:00:00Z',
      completed_work_seconds: 5400,
      total_break_minutes: 45,
      segments: [],
    },
  })
  expect(workedMilliseconds(status, Date.parse('2026-11-14T11:00:00Z'))).toBe(8100_000)
})

it('times out location in ten seconds even if the browser never calls back', async () => {
  vi.useFakeTimers()
  const getCurrentPosition = vi.fn()
  vi.stubGlobal('navigator', { geolocation: { getCurrentPosition } })
  const result = expect(requestLocation()).rejects.toThrow(LOCATION_TIMEOUT)
  await vi.advanceTimersByTimeAsync(10_000)
  await result
  expect(getCurrentPosition).toHaveBeenCalledWith(
    expect.any(Function),
    expect.any(Function),
    expect.objectContaining({ timeout: 10_000, maximumAge: 0 }),
  )
})

it('counts only this period’s part of an overnight shift', () => {
  const entries = [
    shift({
      work_date: '2026-11-15',
      start_time: '22:00',
      end_time: '06:00',
      hours: 8,
    }),
  ]
  expect(periodTotals(entries, { start: '2026-11-16', end: '2026-11-30' })).toEqual({
    total: 6,
    approved: 0,
    waiting: 6,
  })
})

it('keeps the weekly overtime capacity across a pay-period boundary', () => {
  const entries = [
    shift({
      id: 1,
      work_date: '2026-11-15',
      hours: 38,
      start_time: null,
      end_time: null,
      approval_status: 'approved',
    }),
    shift({ id: 2, work_date: '2026-11-16', hours: 8, overtime_status: 'pending' }),
  ]
  expect(withOvertimeHours(entries)[1].pending_overtime_hours).toBe(6)
})

it('never infers Paid from approval or a prepared paycheck', () => {
  expect(periodPaidDate([shift({ approval_status: 'approved' })])).toBeNull()
  const payroll = {
    status: 'payment_prepared' as const,
    label: 'Prepared',
    paid_hours: 0,
    held_hours: 0,
    paychecks: [{ statement_id: '1', pay_date: '2026-11-25' }],
  }
  expect(periodPaidDate([shift({ payroll_status: payroll })])).toBeNull()
  expect(
    periodPaidDate([
      shift({ payroll_status: { ...payroll, status: 'payment_issued' } }),
    ]),
  ).toBe('2026-11-25')
})
