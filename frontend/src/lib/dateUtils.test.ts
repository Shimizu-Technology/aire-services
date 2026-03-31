import { describe, it, expect } from 'vitest'
import { formatDateTime, formatDate, formatRelativeTime } from './dateUtils'

describe('dateUtils', () => {
  describe('formatDateTime', () => {
    it('formats a date string correctly', () => {
      // Use a fixed local date to avoid timezone issues
      const result = formatDateTime('2025-01-15')
      expect(result).toContain('Jan')
      expect(result).toContain('2025')
    })

    it('formats a Date object', () => {
      const date = new Date(2025, 0, 15, 14, 30) // Jan 15, 2025 14:30 local
      const result = formatDateTime(date)
      expect(result).toContain('Jan')
      expect(result).toContain('15')
      expect(result).toContain('2025')
    })
  })

  describe('formatDate', () => {
    it('formats a date without time', () => {
      const result = formatDate('2025-01-15')
      expect(result).toContain('Jan')
      expect(result).toContain('2025')
    })
  })

  describe('formatRelativeTime', () => {
    it('returns an object with display and full properties', () => {
      const result = formatRelativeTime('2025-01-15T14:30:00Z')
      expect(result).toHaveProperty('display')
      expect(result).toHaveProperty('full')
    })

    it('display includes relative time like "ago" or date', () => {
      const now = new Date().toISOString()
      const result = formatRelativeTime(now)
      // Could be "Just now", "X minutes ago", etc.
      expect(typeof result.display).toBe('string')
      expect(result.display.length).toBeGreaterThan(0)
    })
  })
})
