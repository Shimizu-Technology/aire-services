/** "1 matching person · 30 active, 1 ended in total": the match count, and what the whole team is made of. */
export function teamCountSummary(
  matching: number,
  people: Array<{ is_active: boolean; employment_status?: string | null }>,
): string {
  const active = people.filter((person) => person.is_active).length
  const rest = people.filter((person) => !person.is_active)
  const ended = rest.filter((person) => person.employment_status === 'terminated').length
  const inactive = rest.length - ended
  const parts = [`${active} active`, ...(ended ? [`${ended} ended`] : []), ...(inactive ? [`${inactive} inactive`] : [])]
  return `${matching} matching ${matching === 1 ? 'person' : 'people'} · ${parts.join(', ')} in total`
}
