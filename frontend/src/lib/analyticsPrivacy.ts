import type { CaptureResult, Properties } from 'posthog-js'
import { isPayStubPath } from './payStubLinkToken'

// What analytics may see. URL fragments can carry credentials (the pay stub
// link token is one), so every URL property loses its fragment before an
// event leaves the browser, and nothing at all is sent from the pay stub page.

const URL_PROPERTIES = ['$current_url', '$referrer', '$pathname', '$initial_current_url', '$session_entry_url', '$initial_referrer', '$prev_pageview_pathname', '$external_click_url'] as const

export function stripUrlFragment(value: unknown): unknown {
  if (typeof value !== 'string') return value
  const index = value.indexOf('#')
  return index === -1 ? value : value.slice(0, index)
}

function stripProperties(properties: Properties | undefined): Properties | undefined {
  if (!properties) return properties
  const cleaned: Properties = { ...properties }
  for (const key of URL_PROPERTIES) {
    if (key in cleaned) cleaned[key] = stripUrlFragment(cleaned[key])
  }
  return cleaned
}

function pathnameOf(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null
  try {
    return new URL(value, 'https://example.invalid').pathname
  } catch {
    return null
  }
}

/** True while the browser is on a page that must send no analytics. */
export function isPrivateAnalyticsPath(pathname: string): boolean {
  return isPayStubPath(pathname)
}

/** PostHog `before_send`: drop pay stub page events and strip every URL fragment. */
export function sanitizeAnalyticsEvent(event: CaptureResult | null): CaptureResult | null {
  if (!event) return event
  const props = event.properties ?? {}
  const paths = [pathnameOf(props.$current_url), typeof props.$pathname === 'string' ? props.$pathname : null]
  if (typeof window !== 'undefined') paths.push(window.location.pathname)
  if (paths.some((path) => path && isPrivateAnalyticsPath(path))) return null

  return {
    ...event,
    properties: stripProperties(event.properties) ?? {},
    ...(event.$set ? { $set: stripProperties(event.$set) } : {}),
    ...(event.$set_once ? { $set_once: stripProperties(event.$set_once) } : {}),
  }
}
