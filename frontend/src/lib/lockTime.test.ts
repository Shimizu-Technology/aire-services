import { describe, expect, it } from 'vitest'
import { formatLockTime, fromGuamInput, lockDistance, toGuamInput } from './lockTime'

describe('lock time formatting', () => {
  it('formats Guam lock times and plain-language distance', () => {
    const now = new Date('2026-11-19T09:00:00+10:00')
    expect(formatLockTime('2026-11-22T07:00:00Z')).toBe('Sun, Nov 22 at 5:00 PM')
    expect(lockDistance('2026-11-22T17:00:00+10:00', now)).toBe('in 3 days')
    expect(lockDistance('2026-11-20T08:00:00+10:00', now)).toBe('tomorrow')
    expect(lockDistance('2026-11-19T14:00:00+10:00', now)).toBe('in 5 hours')
    expect(lockDistance('2026-11-19T09:12:00+10:00', now)).toBe('in 12 minutes')
    expect(lockDistance('2026-11-19T08:00:00+10:00', now)).toBe('now')
  })

  it('round-trips datetime-local values as Guam time', () => {
    expect(toGuamInput('2026-11-22T07:00:00Z')).toBe('2026-11-22T17:00')
    expect(fromGuamInput('2026-11-22T17:00')).toBe('2026-11-22T17:00:00+10:00')
    expect(fromGuamInput('')).toBeNull()
  })
})
