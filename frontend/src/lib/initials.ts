export function initialsForName(value: string | null | undefined, fallback = 'AT') {
  const initials = value
    ?.split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('')

  return initials || fallback
}
