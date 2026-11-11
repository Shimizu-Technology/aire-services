import { useEffect, useId, useRef, type ComponentPropsWithoutRef, type ReactNode } from 'react'
import { Check, Minus } from 'lucide-react'
import { cx } from '../../lib/cx'

export type CheckedState = boolean | 'mixed'

export interface CheckboxProps extends Omit<ComponentPropsWithoutRef<'input'>, 'type' | 'checked' | 'defaultChecked' | 'onChange' | 'children'> {
  /** `mixed` when some, not all, of the things it stands for are selected. */
  checked: CheckedState
  /** Gets the next state. A mixed box becomes checked. */
  onChange: (checked: boolean) => void
  /** Always required. Hide it with `hideLabel` when the row already shows it, e.g. "Select Marcus Quinata's 2 shifts". */
  label: ReactNode
  hideLabel?: boolean
  /** A line under the visible label. */
  description?: ReactNode
}

/**
 * A real checkbox in the brand style: a 22px box with a 44px hit area that
 * doesn't push the layout around it. Supports the mixed state for group rows.
 */
export function Checkbox({ checked, onChange, label, hideLabel = false, description, disabled, className, id, ...props }: CheckboxProps) {
  const generated = useId()
  const inputId = id ?? generated
  const ref = useRef<HTMLInputElement>(null)
  const mixed = checked === 'mixed'

  // `indeterminate` is a property, not an attribute.
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = mixed
  }, [mixed])

  const box = (
    <span className="relative inline-grid size-[22px] shrink-0 place-items-center">
      <input
        {...props}
        ref={ref}
        id={inputId}
        type="checkbox"
        checked={checked === true}
        aria-checked={mixed ? 'mixed' : undefined}
        aria-label={hideLabel && typeof label === 'string' ? label : props['aria-label']}
        aria-describedby={description ? `${inputId}-description` : props['aria-describedby']}
        disabled={disabled}
        onChange={() => onChange(checked !== true)}
        // The input itself is the 44px target, centred on the 22px box.
        className="peer absolute -inset-[11px] z-[1] m-0 size-11 cursor-pointer appearance-none rounded-full opacity-0 disabled:cursor-not-allowed"
      />
      <span
        aria-hidden="true"
        className={cx(
          'pointer-events-none inline-grid size-[22px] place-items-center rounded-md border-[1.5px] text-white transition-colors duration-(--dur-press)',
          checked === false ? 'border-line-strong bg-surface' : 'border-primary bg-primary',
          'peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-primary',
          'peer-disabled:opacity-50',
        )}
      >
        {checked === true && <Check className="size-4" strokeWidth={3} />}
        {mixed && <Minus className="size-4" strokeWidth={3} />}
      </span>
    </span>
  )

  if (hideLabel && typeof label === 'string') {
    return <span className={cx('inline-flex', className)}>{box}</span>
  }

  return (
    <span className={cx('inline-flex items-start gap-3', className)}>
      {box}
      <span className={cx('min-w-0', hideLabel && 'sr-only')}>
        <label htmlFor={inputId} className={cx('block text-body-sm font-medium text-ink', !disabled && 'cursor-pointer')}>{label}</label>
        {description && <span id={`${inputId}-description`} className="mt-0.5 block text-caption text-ink-muted">{description}</span>}
      </span>
    </span>
  )
}
