/**
 * Link from an Edit shift sheet to that shift's complete history. It carries the
 * person and date for the "Back to Daniel's Nov 14 shift" link, and a return path
 * that reopens the same person, pay period and shift.
 */
export function shiftHistoryHref(
  shift: { entryId: number; workDate: string; personName: string },
  here: { pathname: string; search: string },
): string {
  const back = new URLSearchParams(here.search)
  // The Timecards page opens a linked shift on its person and pay period.
  if (here.pathname === '/admin/timecards' && back.get('user_id')) back.set('entry_id', String(shift.entryId))
  const query = back.toString()
  const params = new URLSearchParams({
    subject_type: 'TimeEntry',
    subject_id: String(shift.entryId),
    shift_person: shift.personName,
    shift_date: shift.workDate,
    return_to: query ? `${here.pathname}?${query}` : here.pathname,
  })
  return `/admin/activity?${params.toString()}`
}
