import { cx } from '../../lib/cx'

export type ProgressTone = 'approved' | 'waiting' | 'neutral'

export interface ProgressPart {
  /** Says what the number is: "approved", "waiting (31 shifts)". */
  label: string
  value: number
  tone: ProgressTone
}

export interface ProgressSplitProps {
  parts: ProgressPart[]
  /** Formats each value for the legend and the spoken label. Defaults to hours: 1,005h. */
  format?: (value: number) => string
  /** Overrides the spoken label. Defaults to "1,005h approved, 276h waiting". */
  label?: string
  showLegend?: boolean
  className?: string
}

const TONES: Record<ProgressTone, string> = {
  approved: 'bg-primary',
  waiting: 'bg-amber-500',
  neutral: 'bg-slate-400',
}

const hours = (value: number) => `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(value)}h`

/** Approved vs waiting as one bar. Read as a single image with both numbers. */
export function ProgressSplit({ parts, format = hours, label, showLegend = true, className }: ProgressSplitProps) {
  const total = parts.reduce((sum, part) => sum + Math.max(0, part.value), 0)
  const spoken = label ?? parts.map(part => `${format(part.value)} ${part.label}`).join(', ')
  return (
    <div className={className}>
      <div role="img" aria-label={spoken} className="flex h-2 overflow-hidden rounded-full bg-slate-200">
        {total > 0 && parts.map(part => (
          <span key={part.label} className={cx('block h-full', TONES[part.tone])} style={{ width: `${(Math.max(0, part.value) / total) * 100}%` }} />
        ))}
      </div>
      {showLegend && (
        <ul aria-hidden="true" className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-caption text-ink-muted">
          {parts.map(part => (
            <li key={part.label} className="inline-flex items-center gap-1.5">
              <span className={cx('size-2 rounded-sm', TONES[part.tone])} />
              <span><span className="font-semibold text-ink tabular-nums">{format(part.value)}</span> {part.label}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
