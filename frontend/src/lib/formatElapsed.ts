/** 3:04:05 (`clock`) or 3h 4m (`short`) for a duration in milliseconds. Negative durations show as zero. */
export function formatElapsed(ms: number, format: 'clock' | 'short' = 'clock') {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (format === 'short') return h > 0 ? `${h}h ${m}m` : `${m}m`
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}
