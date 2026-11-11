import { describe, expect, it } from 'vitest'

// Every app source file (tests excluded), keyed like '../pages/admin/Users.tsx'.
const sources = import.meta.glob<string>(['../**/*.{ts,tsx}', '!../**/*.test.{ts,tsx}', '!../test/**'], {
  query: '?raw',
  import: 'default',
  eager: true,
})

const SUB_12PX_TEXT = /text-\[(?:\d|1[01])(?:\.\d+)?px\]/g

// Files with text below 12px that are waiting on their own page PR (or are
// public marketing pages). Counts can only go down; remove a file once it's 0.
const SUB_12PX_PENDING: Record<string, number> = {
  '../components/layouts/Footer.tsx': 1,
  // 12px wraps the uppercase chips and grows every card; fix in the approvals redesign.
  '../components/time-tracking/ApprovalQueue.tsx': 5,
  // Not verified with a live clock-in; fix with the employee home polish.
  '../components/time-tracking/ClockInOutCard.tsx': 8,
  // 12px wraps "Download PDF Report" at 390px.
  '../components/time-tracking/ReportExportActions.tsx': 1,
  '../components/time-tracking/WhosWorking.tsx': 18,
  '../pages/admin/ActivityHistory.tsx': 3,
  '../pages/admin/PayrollRuns.tsx': 2,
  '../pages/admin/TimeTracking.tsx': 27,
  '../pages/aire/AireHome.tsx': 2,
}

describe('design baseline', () => {
  it('has source files to check', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(50)
  })

  it('uses ConfirmDialog instead of the browser confirm()', () => {
    const offenders = Object.entries(sources)
      .filter(([, source]) => /(?<![\w.])confirm\(\s*[`'"]|window\.confirm\(/.test(source))
      .map(([path]) => path)
    expect(offenders).toEqual([])
  })

  it('adds no new text below 12px', () => {
    const over = Object.entries(sources).flatMap(([path, source]) => {
      const count = source.match(SUB_12PX_TEXT)?.length ?? 0
      const allowed = SUB_12PX_PENDING[path] ?? 0
      // Exact match keeps the allowance a ratchet: lower it when a file improves.
      return count !== allowed ? [`${path}: ${count} (allowed ${allowed}; update the allowance to match)`] : []
    })
    expect(over).toEqual([])
  })
})
