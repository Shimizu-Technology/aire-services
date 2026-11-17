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
      Couldn't refresh {what}.{loadedAt ? ` Last updated ${timeLabel(loadedAt)}.` : ''}{' '}
      <button type="button" onClick={onRetry} className="relative font-semibold text-primary underline pointer-coarse:after:absolute pointer-coarse:after:-inset-x-2 pointer-coarse:after:-inset-y-3 pointer-coarse:after:content-['']">
        Try again
      </button>
    </p>
  )
}
