import { describe, expect, it } from 'vitest'
import { lockControl, period } from '../../test/fixtures/today'
import { lockStatus } from './format'

const NOW = new Date('2026-11-11T19:41:00+10:00')

describe('lockStatus', () => {
  it('is waiting while the lock is more than a day away', () => {
    expect(lockStatus(period, lockControl(), '2026-11-18T17:00:00+10:00', NOW)).toEqual({ label: 'Locks in 7 days', tone: 'waiting', locking: false })
  })

  it('says tomorrow for a lock the next calendar day', () => {
    expect(lockStatus(period, lockControl(), '2026-11-12T20:00:00+10:00', NOW).label).toBe('Locks tomorrow')
  })

  it('is needs-fix inside 24 hours', () => {
    expect(lockStatus(period, lockControl(), '2026-11-12T19:00:00+10:00', NOW)).toMatchObject({ label: 'Locks in 23 hours', tone: 'needs-fix' })
    expect(lockStatus(period, lockControl(), '2026-11-11T20:21:00+10:00', NOW)).toMatchObject({ label: 'Locks in 40 minutes', tone: 'needs-fix' })
    expect(lockStatus(period, lockControl(), '2026-11-11T22:41:00+10:00', NOW)).toMatchObject({ label: 'Locks in 3 hours', tone: 'needs-fix' })
  })

  it('is Locking now at the lock time and after Lock now', () => {
    expect(lockStatus(period, lockControl(), '2026-11-11T19:41:00+10:00', NOW)).toMatchObject({ label: 'Locking now', locking: true })
    expect(lockStatus(period, lockControl(), '2026-11-11T19:30:00+10:00', NOW).locking).toBe(true)
  })

  it('has no pill without a lock time', () => {
    expect(lockStatus(null, null, null, NOW).label).toBeNull()
  })
})
