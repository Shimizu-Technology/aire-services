import { describe, expect, it } from 'vitest'

import { shiftHistoryHref } from './shiftHistory'

const shift = { entryId: 44, workDate: '2026-11-14', personName: 'Daniel Cruz' }

function parse(href: string) {
  const url = new URL(href, 'https://local.invalid')
  return { path: url.pathname, params: url.searchParams }
}

describe('shiftHistoryHref', () => {
  it('keeps the person and period and adds the shift when coming from a person timecard', () => {
    const { path, params } = parse(shiftHistoryHref(shift, { pathname: '/admin/timecards', search: '?user_id=7&period=2026-11-01' }))
    expect(path).toBe('/admin/activity')
    expect(params.get('subject_type')).toBe('TimeEntry')
    expect(params.get('subject_id')).toBe('44')
    expect(params.get('shift_person')).toBe('Daniel Cruz')
    expect(params.get('shift_date')).toBe('2026-11-14')
    expect(params.get('return_to')).toBe('/admin/timecards?user_id=7&period=2026-11-01&entry_id=44')
  })

  it('returns Everyone view unchanged and other pages as they were', () => {
    expect(parse(shiftHistoryHref(shift, { pathname: '/admin/timecards', search: '?view=everyone&period=2026-11-01' })).params.get('return_to'))
      .toBe('/admin/timecards?view=everyone&period=2026-11-01')
    expect(parse(shiftHistoryHref(shift, { pathname: '/admin/time-tracking', search: '' })).params.get('return_to'))
      .toBe('/admin/time-tracking')
  })
})
