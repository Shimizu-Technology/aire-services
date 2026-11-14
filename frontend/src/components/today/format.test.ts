import { describe, expect, it } from 'vitest'
import { lockControl, period } from '../../test/fixtures/today'
import { lockStatus, type LockStatusInput } from './format'

const NOW = new Date('2026-11-11T19:41:00+10:00')

const status = (cutoffAt: string | null, overrides: Partial<LockStatusInput> = {}) =>
  lockStatus({ period, control: lockControl(), cutoffAt, now: NOW, paused: false, ...overrides })

const lockNowPending = lockControl({
  pending_change: { state: 'pending', action: 'lock_now', cutoff_at: null, requested_by_name: 'Chels Cruz', requested_at: '2026-11-11T19:40:00+10:00', error: null },
})

describe('lockStatus', () => {
  it('is waiting while the lock is more than a day away', () => {
    expect(status('2026-11-18T17:00:00+10:00')).toMatchObject({ kind: 'upcoming', label: 'Locks in 7 days', tone: 'waiting', prefix: 'Locks' })
  })

  it('says tomorrow for a lock the next calendar day', () => {
    expect(status('2026-11-12T20:00:00+10:00').label).toBe('Locks tomorrow')
  })

  it('is needs-fix inside 24 hours', () => {
    expect(status('2026-11-12T19:00:00+10:00')).toMatchObject({ label: 'Locks in 23 hours', tone: 'needs-fix' })
    expect(status('2026-11-11T20:21:00+10:00')).toMatchObject({ label: 'Locks in 40 minutes', tone: 'needs-fix' })
  })

  it('keeps counting down in the last minute instead of claiming the lock is happening', () => {
    expect(status('2026-11-11T19:41:45+10:00')).toMatchObject({ kind: 'upcoming', label: 'Locks in under a minute', tone: 'needs-fix' })
  })

  it('says Locking now only once the lock time has passed and the connection is up', () => {
    expect(status('2026-11-11T19:41:00+10:00')).toMatchObject({ kind: 'due', label: 'Locking now', tone: 'info', prefix: 'Lock time' })
    expect(status('2026-11-11T19:30:00+10:00').kind).toBe('due')
    expect(status('2026-11-18T17:00:00+10:00', { control: lockControl({ cutoff_state: 'due' }) }).kind).toBe('due')
  })

  it('says a Lock now is requested and still waiting on Payroll, with the scheduled time kept', () => {
    expect(status('2026-11-18T17:00:00+10:00', { control: lockNowPending })).toMatchObject({
      kind: 'requested',
      label: 'Lock requested · waiting for Cornerstone Payroll',
      tone: 'info',
      prefix: 'Scheduled lock',
    })
  })

  it('puts a due or requested lock on hold while the connection is paused', () => {
    expect(status('2026-11-11T19:30:00+10:00', { paused: true })).toMatchObject({ kind: 'hold', label: 'Lock on hold: connection paused', tone: 'needs-fix' })
    expect(status('2026-11-18T17:00:00+10:00', { paused: true, control: lockNowPending }).kind).toBe('hold')
  })

  it('still counts down toward a lock that is days away while paused', () => {
    expect(status('2026-11-18T17:00:00+10:00', { paused: true }).kind).toBe('upcoming')
  })

  it('names a failed lock', () => {
    expect(status('2026-11-11T19:30:00+10:00', { control: lockControl({ status: 'failed' }) })).toMatchObject({ kind: 'failed', label: 'Lock failed', tone: 'needs-fix' })
  })

  it('has no pill without a lock time', () => {
    expect(status(null, { period: null, control: null }).label).toBeNull()
  })
})
