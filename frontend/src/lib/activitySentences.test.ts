import { describe, expect, it } from 'vitest'

import { actorName, describeChanges, formatGuamTime, formatHours } from './activitySentences'

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
