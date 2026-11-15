/** One source for the badge's default scope and the inbox's initial choice. */
export function approvalDepartment(
  person:
    | { approval_group_keys?: readonly string[]; approval_group?: string | null }
    | null
    | undefined,
  administrator = false,
) {
  if (administrator || !person) return 'all'
  return (
    person.approval_group_keys?.[0] ||
    person.approval_group ||
    (person.approval_group_keys ? 'unassigned' : 'all')
  )
}
