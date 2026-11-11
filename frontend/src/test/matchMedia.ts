import { vi } from 'vitest'

/**
 * A matchMedia that answers min-width/max-width from window.innerWidth and
 * prefers-reduced-motion from `reducedMotion`. Happy DOM has no layout, so
 * component tests set the viewport through this. Returns a restore function.
 */
export function mockMatchMedia({ width = 1280, reducedMotion = false }: { width?: number; reducedMotion?: boolean } = {}) {
  const original = window.matchMedia
  Object.defineProperty(window, 'innerWidth', { value: width, writable: true, configurable: true })
  const evaluate = (query: string) => {
    if (query.includes('prefers-reduced-motion')) return reducedMotion && query.includes('reduce')
    const min = /min-width:\s*(\d+)px/.exec(query)
    const max = /max-width:\s*(\d+)px/.exec(query)
    if (min && window.innerWidth < Number(min[1])) return false
    if (max && window.innerWidth > Number(max[1])) return false
    return Boolean(min || max)
  }
  window.matchMedia = vi.fn((query: string) => ({
    media: query,
    matches: evaluate(query),
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(() => false),
  })) as unknown as typeof window.matchMedia
  return () => { window.matchMedia = original }
}
