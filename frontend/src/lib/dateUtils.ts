// Date formatting utilities for consistent display across the app

/**
 * Format a date/time in a human-readable format
 * Example: "Jan 20, 2026 at 3:36 PM"
 */
export function formatDateTime(dateString: string | Date): string {
  const date = typeof dateString === 'string' ? new Date(dateString) : dateString
  
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }) + ' at ' + date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

/**
 * Format just the date portion
 * Example: "Jan 20, 2026"
 */
export function formatDate(dateString: string | Date): string {
  const date = typeof dateString === 'string' ? new Date(dateString) : dateString
  
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

/**
 * Format a date for work dates (no time component, parse as local date)
 * Example: "Jan 20, 2026"
 */
export function formatWorkDate(dateString: string): string {
  // Parse as local date to avoid timezone issues
  const date = new Date(dateString + 'T00:00:00')
  
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

/**
 * Format as relative time with full date available
 * Returns an object with display text and full date for tooltips
 */
export function formatRelativeTime(dateString: string): { display: string; full: string } {
  const date = new Date(dateString)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  let display: string
  if (diffMins < 1) {
    display = 'Just now'
  } else if (diffMins < 60) {
    display = `${diffMins}m ago`
  } else if (diffHours < 24) {
    display = `${diffHours}h ago`
  } else if (diffDays < 7) {
    display = `${diffDays}d ago`
  } else {
    display = formatDate(date)
  }

  const full = formatDateTime(date)

  return { display, full }
}

/**
 * Format for table columns - shows date and time compactly
 * Example: "1/20/26, 3:36 PM"
 */
export function formatTableDateTime(dateString: string): string {
  const date = new Date(dateString)
  
  return date.toLocaleDateString('en-US', {
    month: 'numeric',
    day: 'numeric',
    year: '2-digit',
  }) + ', ' + date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

/**
 * Format for created/joined dates - just date is fine
 * Example: "Jan 20, 2026"
 */
export function formatCreatedDate(dateString: string): string {
  return formatDate(dateString)
}

/**
 * Format a Date to an ISO date string (YYYY-MM-DD) using LOCAL time.
 * IMPORTANT: Do NOT use date.toISOString().split('T')[0] — that uses UTC
 * and produces the wrong date for timezones ahead of UTC (e.g. Guam UTC+10).
 */
export function formatDateISO(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}
