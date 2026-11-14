import { describe, expect, it } from 'vitest'
import { payrollConnectionCopy } from './payrollConnection'

const delivered = { status: 'delivered', delivered_at: '2026-10-31T17:01:00+10:00', period: { start_date: '2026-10-16', end_date: '2026-10-31' } } as const

describe('connection wording follows the latest lock, not receipt age', () => {
  it.each([
    ['paused', delivered, 0, 'Payroll connection paused'],
    ['delivery_problem', delivered, 1, "Hours haven't reached Cornerstone Payroll yet"],
    ['connected', null, 0, 'Set up, but nothing confirmed yet'],
    ['connected', delivered, 0, 'Connected to Cornerstone Payroll'],
    ['connected', { ...delivered, status: 'pending', delivered_at: null }, 1, "Hours haven't reached Cornerstone Payroll yet"],
    ['connected', { ...delivered, status: null, delivered_at: null }, 0, "Hours haven't reached Cornerstone Payroll yet"],
    ['connected', delivered, 1, "Hours haven't reached Cornerstone Payroll yet"],
  ] as const)('%s / %j / %i uses %s', (state, latest_locked_period_delivery, count, title) => {
    expect(payrollConnectionCopy({ state, last_delivery: delivered, latest_locked_period_delivery, undelivered: { count } }).title).toBe(title)
  })
})
