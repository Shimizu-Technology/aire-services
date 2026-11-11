import { useRef, type KeyboardEvent, type ReactNode } from 'react'
import { cx } from '../../lib/cx'

export interface SegmentedOption<T extends string> {
  value: T
  label: ReactNode
}

export interface SegmentedControlProps<T extends string> {
  /** Names the control, e.g. "Group shifts". */
  label: string
  options: SegmentedOption<T>[]
  value: T
  onChange: (value: T) => void
  /** The id of the region this switches, for aria-controls. */
  controls?: string
  className?: string
}

/**
 * Two to four views of the same content: By person | By day. A tablist, so
 * arrow keys move between options and pick them; Tab leaves the control.
 * No motion: it's switched too often to animate.
 */
export function SegmentedControl<T extends string>({ label, options, value, onChange, controls, className }: SegmentedControlProps<T>) {
  const refs = useRef<Array<HTMLButtonElement | null>>([])

  const onKeyDown = (event: KeyboardEvent, index: number) => {
    const last = options.length - 1
    const next = event.key === 'ArrowRight' ? (index === last ? 0 : index + 1)
      : event.key === 'ArrowLeft' ? (index === 0 ? last : index - 1)
        : event.key === 'Home' ? 0
          : event.key === 'End' ? last
            : null
    if (next === null) return
    event.preventDefault()
    refs.current[next]?.focus()
    onChange(options[next].value)
  }

  return (
    <div role="tablist" aria-label={label} className={cx('inline-flex max-w-full gap-0.5 rounded-[0.625rem] bg-slate-100 p-[3px]', className)}>
      {options.map((option, index) => {
        const selected = option.value === value
        return (
          <button
            key={option.value}
            ref={(element) => { refs.current[index] = element }}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={controls}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={cx(
              'inline-flex min-h-11 min-w-0 items-center justify-center whitespace-nowrap rounded-control px-3 text-body-sm font-semibold transition-colors duration-150 pointer-fine:min-h-8',
              'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary',
              selected ? 'bg-surface text-ink shadow-[0_1px_2px_rgb(15_23_42/0.12)]' : 'text-ink-muted hover:text-ink',
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
