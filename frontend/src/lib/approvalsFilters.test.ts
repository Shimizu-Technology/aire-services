import { describe, expect, it } from 'vitest'
import { approvalSelection, exclusionCopy, isOrdinary, pendingParams } from './approvalsFilters'
import { reviewEntry } from '../test/approvalFixtures'
const entry = (id: number, overrides = {}) => reviewEntry(id, id, { version: id + 7, ...overrides })
describe('approval snapshots', () => {
  it('uses exactly the selected displayed rows and versions', () => {
    const displayed = [entry(2), entry(9)]
    const snapshot = approvalSelection(displayed)
    expect(snapshot.items).toEqual([
      { id: 2, version: 9, approve_time: true, approve_overtime: false },
      { id: 9, version: 16, approve_time: true, approve_overtime: false },
    ])
    expect(snapshot.rows).toEqual(displayed)
    expect(snapshot.people.length).toBe(2)
    expect(snapshot.hours).toBe(16)
  })
  it.each([
    { review_kind: 'needs_look', exceptions: [{ key: 'added', label: 'Added by hand' }] },
    { overtime_status: 'pending' },
    { needs_another_approver: true },
    { version: undefined },
  ])('rejects unsafe batch input %j', overrides => {
    expect(isOrdinary(entry(1, overrides))).toBe(false)
    expect(() => approvalSelection([entry(1, overrides)])).toThrow()
  })
  it('does not treat a paged or filtered list as an implicit wider selection', () => {
    expect(approvalSelection([entry(12)]).items.map(item => item.id)).toEqual([12])
  })
  it('keeps reminder filters and expands a period query', () => {
    expect(
      pendingParams(
        new URLSearchParams('period=2026-11-01&user_id=4&through_date=2026-11-10'),
        'cfi',
      ),
    ).toMatchObject({
      start_date: '2026-11-01',
      end_date: '2026-11-15',
      through_date: '2026-11-10',
      user_id: '4',
      approval_group: 'cfi',
    })
  })
})

it('names excluded shift counts and overtime hours in the confirmation', () => {
  const overtime = entry(2, {
    review_kind: 'needs_look',
    overtime_status: 'pending',
    pending_overtime_hours: 6,
    exceptions: [{ key: 'overtime', label: 'Overtime' }],
  })
  expect(exclusionCopy([overtime])).toContain('1 shift · Overtime · 6.0h overtime waiting')
})
