import { describe, expect, it } from 'vitest'
import {
  approvalChunks,
  approvalSelection,
  exclusionCopy,
  isOrdinary,
  leaveMatchesDates,
  pendingParams,
} from './approvalsFilters'
import { reviewEntry } from '../test/approvalFixtures'
const entry = (id: number, overrides = {}) =>
  reviewEntry(id, id, { version: id + 7, ...overrides })
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
  ])('rejects unsafe batch input %j', (overrides) => {
    expect(isOrdinary(entry(1, overrides))).toBe(false)
    expect(() => approvalSelection([entry(1, overrides)])).toThrow()
  })
  it('does not treat a paged or filtered list as an implicit wider selection', () => {
    expect(approvalSelection([entry(12)]).items.map((item) => item.id)).toEqual([12])
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

it('packs a person’s Sunday–Saturday week together across the old boundary', () => {
  const rows = Array.from({ length: 99 }, (_, index) => reviewEntry(index + 1, index + 1))
  rows.push(reviewEntry(100, 100, { work_date: '2026-11-09' }))
  rows.push(reviewEntry(101, 100, { work_date: '2026-11-10' }))
  const chunks = approvalChunks(approvalSelection(rows).items, 100, rows)
  expect(chunks.map((chunk) => chunk.length)).toEqual([99, 2])
  expect(chunks[1].map((item) => item.id)).toEqual([100, 101])
  expect(
    chunks
      .flat()
      .map((item) => item.id)
      .sort((a, b) => a - b),
  ).toEqual(rows.map((row) => row.id))
})
it('separates Sunday weeks and splits only a group exceeding the API limit', () => {
  const rows = [
    reviewEntry(1, 1, { work_date: '2026-11-14' }),
    reviewEntry(2, 1, { work_date: '2026-11-15' }),
    reviewEntry(3, 1, { work_date: '2026-11-16' }),
  ]
  expect(
    approvalChunks(approvalSelection(rows).items, 2, rows).map((chunk) =>
      chunk.map((item) => item.id),
    ),
  ).toEqual([[1], [2, 3]])
  expect(
    approvalChunks(
      approvalSelection([reviewEntry(1), reviewEntry(2, 1), reviewEntry(3, 1)]).items,
      2,
      [reviewEntry(1), reviewEntry(2, 1), reviewEntry(3, 1)],
    ).map((chunk) => chunk.length),
  ).toEqual([2, 1])
})

it('keeps a sub-minute shift out of every ordinary snapshot', () => {
  const tiny = reviewEntry(1, 1, { clock_out_at: '2026-11-09T22:00:30Z', hours: 0.01 })
  expect(isOrdinary(tiny)).toBe(false)
  expect(() => approvalSelection([tiny])).toThrow('Choose ordinary shifts')
})

it.each([
  ['date=2026-11-21', true],
  ['date=2026-11-22', false],
  ['through_date=2026-11-20', true],
  ['through_date=2026-11-19', false],
  ['since_date=2026-11-21', true],
  ['since_date=2026-11-22', false],
  ['start_date=2026-11-21&end_date=2026-11-30', true],
  ['start_date=2026-11-22&end_date=2026-11-30', false],
  ['period=2026-11-16', true],
  ['period=2026-11-01', false],
])('applies inclusive leave overlap for %s', (query, expected) => {
  expect(
    leaveMatchesDates(
      { start_date: '2026-11-20', end_date: '2026-11-21' },
      new URLSearchParams(query),
    ),
  ).toBe(expected)
})
