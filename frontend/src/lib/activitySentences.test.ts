import { describe, expect, it } from 'vitest'

import { actorName, describeChanges, describeEvent, formatGuamTime, formatHours } from './activitySentences'

const chels = { id: 1, name: 'Chels', email: 'chels@example.com', role: 'admin', kind: 'user' }

describe('describeChanges', () => {
  it('turns a saved clock-out correction into the sentences Chels expects', () => {
    expect(describeChanges({
      actor: chels,
      changes: { end_time: { from: '3:30 PM', to: '3:00 PM' }, hours: { from: 8, to: 7.5 } },
      details: { correction_reason: 'Left early, confirmed with Daniel' },
    })).toEqual([
      'Chels changed clock-out from 3:30 PM to 3:00 PM.',
      'Hours changed from 8.0 to 7.5.',
      'Reason: Left early, confirmed with Daniel',
    ])
  })

  it('reads the older [from, to] pair shape and lists several fields in one sentence', () => {
    expect(describeChanges({
      actor: chels,
      changes: { work_date: ['2026-11-13', '2026-11-14'], start_time: ['8:00 AM', '8:30 AM'], break_minutes: [0, 30] },
      details: {},
    })).toEqual(['Chels changed work date from Nov 13 to Nov 14, clock-in from 8:00 AM to 8:30 AM and break from none to 30 minutes.'])
  })

  it('never prints raw ids, internal status names or timestamps', () => {
    const sentences = describeChanges({
      actor: chels,
      changes: {
        time_category_id: { from: 3, to: 5 },
        overtime_status: { from: 'none', to: 'pending' },
        clock_out_at: { from: '2026-11-14T05:30:00.000000Z', to: '2026-11-14T05:00:00.000000Z' },
        breaks: { from: [], to: [{ start_time: 'x' }] },
      },
      details: {},
    })
    expect(sentences).toHaveLength(1)
    expect(sentences[0]).toBe('Chels changed the kind of work, overtime approval from none to waiting, clock-out from Sat, Nov 14, 3:30 PM to Sat, Nov 14, 3:00 PM and the detailed breaks.')
    expect(sentences[0]).not.toMatch(/\bid\b|pending|\{|\[|Z\b/)
  })

  it('does not repeat a timestamp when clock-in and clock-out times are already described', () => {
    expect(describeChanges({
      actor: chels,
      changes: { end_time: { from: '3:30 PM', to: '3:00 PM' }, clock_out_at: { from: 'a', to: 'b' }, clock_in_at: { from: 'c', to: 'd' } },
      details: {},
    })).toEqual(['Chels changed clock-out from 3:30 PM to 3:00 PM.'])
  })

  it('names the actor when only hours changed and handles missing actor names', () => {
    expect(describeChanges({ actor: { ...chels, name: null }, changes: { hours: { from: 8, to: 7.25 } }, details: {} }))
      .toEqual(['chels changed hours from 8.0 to 7.25.'])
  })

  it('is empty when no fields changed, and ignores a reason with nothing to explain', () => {
    expect(describeChanges({ actor: chels, changes: {}, details: { review_note: 'ok' } })).toEqual([])
  })
})

describe('formatting helpers', () => {
  it('formats hours with at least one decimal', () => {
    expect(formatHours(8)).toBe('8.0')
    expect(formatHours(7.5)).toBe('7.5')
    expect(formatHours(7.126)).toBe('7.13')
  })

  it('shows Guam time and a safe actor name', () => {
    expect(formatGuamTime('2026-11-14T05:42:00Z')).toBe('Sat, Nov 14, 3:42 PM')
    expect(actorName({ actor: { ...chels, name: null, email: null } })).toBe('Someone')
  })
})

describe('describeEvent: snapshots kept in details.before and details.after', () => {
  const ana = { id: 3, name: 'Ana', email: 'ana@example.com', role: 'manager', kind: 'user' }
  const subject = { type: 'TimeEntry', id: 9, name: '8 hours on 2026-11-13' }
  const before = { work_date: '2026-11-13', start_time: '2026-11-12T21:00:00.000000Z', end_time: null, clock_in_at: '2026-11-12T21:00:00.000000Z', clock_out_at: null, hours: 0, break_minutes: 0, time_category_id: 1, approval_status: 'approved', status: 'clocked_in', lock_version: 3, breaks: [] }

  it('says Ana ended the clock, when, and what it came to', () => {
    const after = { ...before, end_time: '2026-11-13T07:00:00.000000Z', clock_out_at: '2026-11-13T07:00:00.000000Z', hours: 8, approval_status: 'pending', status: 'completed', lock_version: 4 }
    const result = describeEvent({ action: 'time_entry.clock_ended', actor: ana, subject, changes: {}, details: { correction_reason: 'Forgot to clock out', before, after } })
    expect(result.sentences).toEqual([
      'Ana ended the clock at 5:00 PM.',
      'The shift is now 8.0 hours and waiting for approval.',
      'Reason: Forgot to clock out',
    ])
    expect(result.usedKeys).toEqual(['correction_reason'])
    expect(result.sentences.join(' ')).not.toMatch(/[{}[\]"]|lock_version|approval_status/)
  })

  it('names a clock ended on another day', () => {
    const after = { ...before, clock_out_at: '2026-11-14T03:30:00.000000Z', end_time: '2026-11-14T03:30:00.000000Z', hours: 8 }
    expect(describeEvent({ action: 'time_entry.clock_ended', actor: ana, subject, changes: {}, details: { before, after } }).sentences[0])
      .toBe('Ana ended the clock at 1:30 PM on Nov 14.')
  })

  it('says a denied shift was changed and sent back, with what changed', () => {
    const beforeDenied = { ...before, status: 'completed', end_time: '2026-11-13T05:30:00.000000Z', clock_out_at: '2026-11-13T05:30:00.000000Z', hours: 8, approval_status: 'denied' }
    const after = { ...beforeDenied, end_time: '2026-11-13T05:00:00.000000Z', clock_out_at: '2026-11-13T05:00:00.000000Z', hours: 7.5, approval_status: 'pending', time_category_id: 2 }
    expect(describeEvent({ action: 'time_entry.denied_resubmitted', actor: ana, subject, changes: {}, details: { correction_reason: 'Wrong end time', before: beforeDenied, after } }).sentences).toEqual([
      'Ana changed the shift and sent it back for approval.',
      'Changes: clock-out from 3:30 PM to 3:00 PM and kind of work.',
      'Hours changed from 8.0 to 7.5.',
      'Reason: Wrong end time',
    ])
  })

  it('says a Payroll correction came from Payroll, with its reason', () => {
    const chels = { ...ana, name: 'Chels' }
    const after = { ...before, hours: 7.5, end_time: '2026-11-13T05:00:00.000000Z' }
    const result = describeEvent({ action: 'payroll_cockpit.time_entry_corrected', actor: chels, subject, changes: {}, details: { reason: 'Matches the paper timesheet', before, after } })
    expect(result.sentences[0]).toBe('Chels corrected the shift from Payroll: Matches the paper timesheet.')
    expect(result.usedKeys).toEqual(['reason'])
  })

  it('gives an unknown action with recorded data a plain sentence, never the data', () => {
    const result = describeEvent({ action: 'time_entry.something_new', actor: ana, subject, changes: { mystery: { nested: { deep: 1 } } }, details: { before: { x: 1 }, after: { x: 2 } } })
    expect(result.sentences).toEqual(['Ana made a change to this shift.'])
    const bare = describeEvent({ action: 'time_entry.something_new', actor: ana, subject, changes: { odd: ['a', 'b', 'c'] }, details: {} })
    expect(bare.sentences).toEqual(['Ana changed odd.'])
  })

  it('stays silent for events with nothing recorded, where the summary already says it', () => {
    expect(describeEvent({ action: 'time_entry.approved', actor: ana, subject, changes: {}, details: { review_note: 'ok' } }).sentences).toEqual([])
  })

  it('reads hours stored as numeric strings, as Rails snapshots keep them', () => {
    const stringBefore = { ...before, hours: '0.0', break_minutes: '0' }
    const ended = { ...before, end_time: '2026-11-13T07:00:00.000000Z', clock_out_at: '2026-11-13T07:00:00.000000Z', hours: '8.47', break_minutes: '0' }
    expect(describeEvent({ action: 'time_entry.clock_ended', actor: ana, subject, changes: {}, details: { before: stringBefore, after: ended } }).sentences)
      .toEqual(['Ana ended the clock at 5:00 PM.', 'The shift is now 8.47 hours and waiting for approval.'])
    const resubmitted = describeEvent({
      action: 'time_entry.denied_resubmitted', actor: ana, subject, changes: {},
      details: { before: { ...ended, hours: '8.47', break_minutes: '0' }, after: { ...ended, hours: '7.5', break_minutes: '30' } },
    })
    expect(resubmitted.sentences).toEqual([
      'Ana changed the shift and sent it back for approval.',
      'Changes: break from none to 30 minutes.',
      'Hours changed from 8.47 to 7.5.',
    ])
  })

  it('does not call an unchanged string and number the same hours a change', () => {
    const result = describeEvent({
      action: 'time_entry.denied_resubmitted', actor: ana, subject, changes: {},
      details: { before: { ...before, hours: '8.0' }, after: { ...before, hours: 8 } },
    })
    expect(result.sentences).toEqual(['Ana changed the shift and sent it back for approval.'])
  })
})
