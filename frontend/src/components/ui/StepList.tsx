import type { ReactNode } from 'react'
import { cx } from '../../lib/cx'

export interface Step {
  id: string
  label: ReactNode
}

type Orientation = 'horizontal' | 'vertical' | 'responsive'

export interface StepListProps {
  /** Names the list: "Hand-off to Cornerstone Payroll". */
  label: string
  steps: Step[]
  /** The step happening now; earlier steps are done. */
  current: string
  /** The current step is finished too (e.g. Paid), so every step reads as done. */
  complete?: boolean
  /** `responsive` stacks below 640px and runs across from there. */
  orientation?: Orientation
  className?: string
}

// Literal class strings per layout so Tailwind can see them.
const LIST: Record<Orientation, string> = {
  vertical: 'flex flex-col gap-1',
  horizontal: 'flex items-start',
  responsive: 'flex flex-col gap-1 sm:flex-row sm:items-start sm:gap-0',
}
const ITEM: Record<Orientation, string> = {
  vertical: 'flex min-h-8 items-center gap-3',
  horizontal: 'relative flex-1 pr-2 pt-[1.125rem]',
  responsive: 'flex min-h-8 items-center gap-3 sm:relative sm:block sm:min-h-0 sm:flex-1 sm:pr-2 sm:pt-[1.125rem]',
}
const LINE: Record<Orientation, string> = {
  vertical: 'hidden',
  horizontal: 'absolute inset-x-0 top-1 h-0.5',
  responsive: 'hidden sm:absolute sm:inset-x-0 sm:top-1 sm:block sm:h-0.5',
}
const DOT: Record<Orientation, string> = {
  vertical: '',
  horizontal: 'absolute left-0 top-0',
  responsive: 'sm:absolute sm:left-0 sm:top-0',
}
const SPOKEN = { done: 'Done:', now: 'Now:', next: 'Not yet:' } as const

/** Progress through a fixed sequence, as an ordered list with aria-current="step". */
export function StepList({ label, steps, current, complete = false, orientation = 'responsive', className }: StepListProps) {
  const currentIndex = Math.max(0, steps.findIndex(step => step.id === current))
  return (
    <ol aria-label={label} className={cx(LIST[orientation], className)}>
      {steps.map((step, index) => {
        const status = index < currentIndex || (complete && index === currentIndex) ? 'done' : index === currentIndex ? 'now' : 'next'
        return (
          <li
            key={step.id}
            data-state={status}
            aria-current={status === 'now' ? 'step' : undefined}
            className={cx(ITEM[orientation], 'text-caption', status === 'next' ? 'text-ink-subtle' : 'text-ink', status === 'now' && 'font-semibold')}
          >
            <span aria-hidden="true" className={cx(LINE[orientation], status === 'done' ? 'bg-primary' : 'bg-line')} />
            <span
              aria-hidden="true"
              className={cx(
                'inline-block size-2.5 shrink-0 rounded-full border-2',
                DOT[orientation],
                status === 'done' ? 'border-primary bg-primary' : status === 'now' ? 'border-primary bg-surface' : 'border-line-strong bg-surface',
              )}
            />
            <span><span className="sr-only">{SPOKEN[status]} </span>{step.label}</span>
          </li>
        )
      })}
    </ol>
  )
}
