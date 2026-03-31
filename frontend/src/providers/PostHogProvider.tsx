import { useEffect } from 'react'
import posthog from 'posthog-js'
import { PostHogProvider as PHProvider, usePostHog } from 'posthog-js/react'
import { useLocation } from 'react-router-dom'

const POSTHOG_KEY = import.meta.env.VITE_PUBLIC_POSTHOG_KEY
const POSTHOG_HOST = import.meta.env.VITE_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com'
const isPostHogEnabled = Boolean(POSTHOG_KEY && POSTHOG_KEY !== 'YOUR_POSTHOG_KEY')

// Initialize PostHog
if (isPostHogEnabled && typeof window !== 'undefined') {
  posthog.init(POSTHOG_KEY, {
    api_host: POSTHOG_HOST,
    defaults: '2025-11-30', // Use recommended defaults
    capture_pageview: false, // We'll capture manually for SPA
    capture_pageleave: true,
    autocapture: true,
  })
}

/**
 * Page view tracker for SPA navigation
 * Must be used inside BrowserRouter
 */
export function PostHogPageView() {
  const location = useLocation()
  const posthogClient = usePostHog()

  useEffect(() => {
    if (posthogClient && isPostHogEnabled) {
      posthogClient.capture('$pageview', {
        $current_url: window.location.href,
        $pathname: location.pathname,
      })
    }
  }, [location, posthogClient])

  return null
}

interface PostHogProviderProps {
  children: React.ReactNode
}

/**
 * PostHog analytics provider
 * Wraps the app with PostHogProvider if configured
 */
export function PostHogProvider({ children }: PostHogProviderProps) {
  // If PostHog is not configured, just render children without the provider
  if (!isPostHogEnabled) {
    if (import.meta.env.DEV) {
      console.info('ℹ️ PostHog not configured - analytics disabled. Add VITE_PUBLIC_POSTHOG_KEY to .env.local')
    }
    return <>{children}</>
  }

  return (
    <PHProvider client={posthog}>
      {children}
    </PHProvider>
  )
}

// Export for use in components
export { usePostHog, isPostHogEnabled }
