import { timeLabel } from './format'

export interface StaleNoteProps {
  /** What a refresh could not update: "the list". */
  what: string
  loadedAt: Date | null
  onRetry: () => void
}

/** A refresh failed but the last good answer is still on screen. */
export function StaleNote({ what, loadedAt, onRetry }: StaleNoteProps) {
  return (
    <p role="status" className="text-caption text-ink-muted">
      Couldn't refresh {what}.{loadedAt ? ` Showing what loaded at ${timeLabel(loadedAt)}.` : ''}{' '}
      <button type="button" onClick={onRetry} className="min-h-11 font-semibold text-primary underline pointer-fine:min-h-0">
        Try again
      </button>
    </p>
  )
}
