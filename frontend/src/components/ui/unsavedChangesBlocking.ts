import type { Location } from 'react-router-dom'

export type ShouldBlock = (current: Location, next: Location) => boolean

/**
 * The default: ask only when the page itself changes. Query changes on the
 * same page (filters, `?tab=`, `?period=`) keep the draft, so they're free.
 */
export const blockPathChanges: ShouldBlock = (current, next) => current.pathname !== next.pathname

/**
 * Also ask when one of these query parameters changes, for a draft that
 * lives in one tab or period: `shouldBlock: blockPathOrParams('tab')`.
 */
export function blockPathOrParams(...params: string[]): ShouldBlock {
  return (current, next) => {
    if (blockPathChanges(current, next)) return true
    const before = new URLSearchParams(current.search)
    const after = new URLSearchParams(next.search)
    return params.some(param => before.get(param) !== after.get(param))
  }
}
