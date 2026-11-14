import { describe, expect, it } from 'vitest'
import { payrollConnectionCopy } from './payrollConnection'

const now = new Date('2026-11-14T12:00:00+10:00')
const delivery = (delivered_at: string) => ({ delivered_at })

describe('connection wording for backend states', () => {
  it.each([
    ['paused', null, 'Payroll connection paused'],
    ['delivery_problem', null, "Hours haven't reached Cornerstone Payroll yet"],
    ['connected', null, 'Set up, but nothing confirmed yet'],
    ['connected', delivery('2026-11-14T11:00:00+10:00'), 'Connected to Cornerstone Payroll'],
    ['connected', delivery('2026-11-12T11:00:00+10:00'), 'No recent receipt from Cornerstone Payroll'],
    ['connected', delivery('2026-11-15T11:00:00+10:00'), 'No recent receipt from Cornerstone Payroll'],
    ['delivery_problem', delivery('2026-11-14T11:00:00+10:00'), "Hours haven't reached Cornerstone Payroll yet"],
  ] as const)('%s with %j uses %s', (state, last_delivery, title) => {
    expect(payrollConnectionCopy({ state, last_delivery }, now).title).toBe(title)
  })
})
