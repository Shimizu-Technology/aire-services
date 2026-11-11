import type { ReactNode } from 'react'
import { AlertCircle } from 'lucide-react'
import { cx } from '../../lib/cx'
import { Button } from './Button'

export interface ErrorStateProps {
  /** What failed, in the section's words: "Couldn't load approvals." */
  title: ReactNode
  /** Optional detail or what still works. */
  description?: ReactNode
  onRetry?: () => void
  retryLabel?: string
  /** Shows the retry as busy while the request runs. */
  retrying?: boolean
  className?: string
}

/**
 * A failed section, shown in place of that section only so the rest of the
 * page stays usable. Announced once when it appears.
 */
export function ErrorState({ title, description, onRetry, retryLabel = 'Try again', retrying = false, className }: ErrorStateProps) {
  return (
    <div role="alert" className={cx('flex flex-col gap-3 rounded-card border border-red-200 bg-danger-soft px-4 py-3 sm:flex-row sm:items-center', className)}>
      <AlertCircle aria-hidden="true" className="hidden size-5 shrink-0 text-danger sm:block" />
      <div className="min-w-0 flex-1 text-body-sm">
        <p className="font-semibold text-red-900">{title}</p>
        {description && <p className="mt-0.5 text-red-900/80">{description}</p>}
      </div>
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry} loading={retrying} className="self-start sm:self-auto">
          {retryLabel}
        </Button>
      )}
    </div>
  )
}
