import { Link } from 'react-router-dom'
import { ChecklistItem, ErrorState, buttonClasses } from '../ui'
import { Skeleton } from '../ui/Skeleton'
import { plural, timeLabel } from '../today/format'
import { checklistEntries, type ChecklistInput } from './payPeriodModel'

export type InputLoad = 'loading' | 'error' | 'ready' | 'stale'

export interface ChecklistSource {
  load: InputLoad
  /** When its last good answer arrived. */
  loadedAt: Date | null
  /** Older than this counts as out of date even when the last refresh worked. */
  maxAgeMs?: number
}

export interface BeforeLockChecklistProps extends ChecklistInput {
  /** Every source the checklist needs. Readiness is claimed only when all of them just loaded. */
  sources: ChecklistSource[]
  /** The page's clock, for the age of each source. */
  now: Date
  onRetry: () => void
}

/**
 * Is the period ready to lock? Every line is done, open with one action, or a
 * note. While any source is stale or failed the lines stay up but are
 * qualified, and "all clear" is never claimed.
 */
export function BeforeLockChecklist({ sources, now, onRetry, ...input }: BeforeLockChecklistProps) {
  const entries = checklistEntries(input)
  const loading = entries.length === 0 && sources.some(source => source.load === 'loading')
  const failed = entries.length === 0 && sources.some(source => source.load === 'error') && !sources.some(source => source.load === 'loading')
  const aged = sources.filter(source => source.load === 'ready' && source.maxAgeMs !== undefined && source.loadedAt !== null
    && now.getTime() - source.loadedAt.getTime() > source.maxAgeMs)
  const current = sources.every(source => source.load === 'ready') && aged.length === 0
  const stale = sources.filter(source => source.load === 'stale' || source.load === 'error')
  const oldest = stale.map(source => source.loadedAt).filter((at): at is Date => at !== null).sort((a, b) => a.getTime() - b.getTime())[0] ?? null
  const open = entries.filter(entry => entry.status === 'todo').length
  const summary = current ? (open === 0 ? 'all clear' : `${plural(open, 'thing')} to do`) : null

  return (
    <section aria-labelledby="before-it-locks" className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h2 id="before-it-locks" className="text-body font-semibold text-ink">
          Before it locks
          {entries.length > 0 && summary && <span className="font-normal text-ink-muted"> · {summary}</span>}
        </h2>
        <p className="text-caption text-ink-muted">Anything still waiting moves to the next pay period.</p>
      </div>
      {loading && <Skeleton className="h-40 w-full" />}
      {failed && <ErrorState title="Couldn't load the checklist." onRetry={onRetry} />}
      {entries.length > 0 && stale.length > 0 && (
        <p role="status" className="rounded-control border border-amber-200 bg-amber-50 px-3 py-2 text-body-sm text-amber-950">
          Couldn't refresh the checklist{oldest ? ` · Last updated ${timeLabel(oldest)}` : ''}{stale.some(source => !source.loadedAt) ? " · Some lines couldn't load" : ''}. It may not be ready to lock.{' '}
          <button type="button" onClick={onRetry} className="min-h-11 font-semibold underline pointer-fine:min-h-0">Try again</button>
        </p>
      )}
      {entries.length > 0 && stale.length === 0 && aged.length > 0 && (
        <p role="status" className="rounded-control border border-amber-200 bg-amber-50 px-3 py-2 text-body-sm text-amber-950">
          Some lines were last updated {timeLabel(aged.map(source => source.loadedAt!).sort((a, b) => a.getTime() - b.getTime())[0])}. It may not be ready to lock.{' '}
          <button type="button" onClick={onRetry} className="min-h-11 font-semibold underline pointer-fine:min-h-0">Refresh</button>
        </p>
      )}
      {entries.length > 0 && !current && stale.length === 0 && aged.length === 0 && (
        <p className="text-caption text-ink-muted">Still loading some lines.</p>
      )}
      {entries.length > 0 && (
        <ul className="divide-y divide-line rounded-card border border-line bg-surface">
          {entries.map(entry => (
            <ChecklistItem
              key={entry.key}
              status={entry.status}
              meta={entry.meta}
              action={entry.action && (
                <Link to={entry.action.to} className={buttonClasses({ variant: 'secondary', size: 'sm' })}>
                  {entry.action.label}
                  <span className="sr-only">: {entry.text}</span>
                </Link>
              )}
            >
              {entry.text}
            </ChecklistItem>
          ))}
        </ul>
      )}
    </section>
  )
}
