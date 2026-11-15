/**
 * Link from an Edit shift sheet to that shift's complete history. It carries the
 * person and date for the "Back to Daniel's Nov 14 shift" link, and a return path
 * that reopens Edit shift on that shift: `entry_id` (`entry` on the person page)
 * names it and `return=edit` asks the page to fetch its current state, follow it to
 * its current person and pay period, and open it again.
 */
export const RETURN_PARAM = 'return'
export const RETURN_EDIT = 'edit'

/** The query parameter a page uses for "this shift". */
export function shiftParamFor(pathname: string) {
  return pathname.startsWith('/admin/users/') ? 'entry' : 'entry_id'
}

export function shiftHistoryHref(
  shift: { entryId: number; workDate: string; personName: string },
  here: { pathname: string; search: string },
): string {
  const back = new URLSearchParams(here.search)
  back.set(shiftParamFor(here.pathname), String(shift.entryId))
  back.set(RETURN_PARAM, RETURN_EDIT)
  const params = new URLSearchParams({
    subject_type: 'TimeEntry',
    subject_id: String(shift.entryId),
    shift_person: shift.personName,
    shift_date: shift.workDate,
    return_to: `${here.pathname}?${back.toString()}`,
  })
  return `/admin/activity?${params.toString()}`
}
