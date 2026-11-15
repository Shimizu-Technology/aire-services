import { describe, expect, it } from 'vitest'

import { shiftHistoryHref } from './shiftHistory'

const shift = { entryId: 44, workDate: '2026-11-14', personName: 'Daniel Cruz' }

function parse(href: string) {
  const url = new URL(href, 'https://local.invalid')
  return { path: url.pathname, params: url.searchParams }
}

describe('shiftHistoryHref', () => {
  it('names the shift and asks the page to reopen it, on a person timecard', () => {
    const { path, params } = parse(shiftHistoryHref(shift, { pathname: '/admin/timecards', search: '?user_id=7&period=2026-11-01' }))
    expect(path).toBe('/admin/activity')
    expect(params.get('subject_type')).toBe('TimeEntry')
    expect(params.get('subject_id')).toBe('44')
    expect(params.get('shift_person')).toBe('Daniel Cruz')
    expect(params.get('shift_date')).toBe('2026-11-14')
    expect(params.get('return_to')).toBe('/admin/timecards?user_id=7&period=2026-11-01&entry_id=44&return=edit')
  })

  it('does the same from Everyone and from the classic views, which have no person in the URL', () => {
    expect(parse(shiftHistoryHref(shift, { pathname: '/admin/timecards', search: '?view=everyone&period=2026-11-01' })).params.get('return_to'))
      .toBe('/admin/timecards?view=everyone&period=2026-11-01&entry_id=44&return=edit')
    expect(parse(shiftHistoryHref(shift, { pathname: '/admin/approvals', search: '?classic=1' })).params.get('return_to'))
      .toBe('/admin/approvals?classic=1&entry_id=44&return=edit')
    expect(parse(shiftHistoryHref(shift, { pathname: '/admin/time-tracking', search: '' })).params.get('return_to'))
      .toBe('/admin/time-tracking?entry_id=44&return=edit')
  })

  it('uses the person page\'s own shift parameter there', () => {
    expect(parse(shiftHistoryHref(shift, { pathname: '/admin/users/7', search: '?tab=time&period=2026-11-01' })).params.get('return_to'))
      .toBe('/admin/users/7?tab=time&period=2026-11-01&entry=44&return=edit')
  })

  it('replaces an older shift or return request instead of stacking them', () => {
    expect(parse(shiftHistoryHref(shift, { pathname: '/admin/timecards', search: '?entry_id=9&return=edit&user_id=7' })).params.get('return_to'))
      .toBe('/admin/timecards?entry_id=44&return=edit&user_id=7')
  })
})
