import { describe, expect, it } from 'vitest'
import { formatApprovalDate, formatApprovalDateRange } from './approvalsDates'
const now = new Date('2026-11-14T09:00:00+10:00')

describe('approval row dates', () => {
  it('omits the current Guam year and retains other years', () => {
    expect(formatApprovalDate('2026-11-06', now)).toBe('Fri, Nov 6')
    expect(formatApprovalDate('2025-11-06', now)).toBe('Thu, Nov 6, 2025')
    const guamNewYear = new Date('2025-12-31T16:00:00Z')
    expect(formatApprovalDate('2026-01-01', guamNewYear)).toBe('Thu, Jan 1')
  })

  it.each([
    [['2026-11-10', '2026-11-11'], 'Nov 10–11'],
    [['2026-11-10', '2026-11-10'], 'Nov 10'],
    [['2026-10-31', '2026-11-01'], 'Oct 31–Nov 1'],
    [['2025-11-10', '2025-11-11'], 'Nov 10–11, 2025'],
    [['2025-12-31', '2026-01-01'], 'Dec 31, 2025–Jan 1, 2026'],
  ])('formats compact group dates %j', (dates, label) => {
    expect(formatApprovalDateRange(dates, now)).toBe(label)
  })
})
