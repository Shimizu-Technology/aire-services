import { useId, type ReactNode } from 'react'
import { cx } from '../../lib/cx'

export interface SwitchProps {
  checked: boolean
  onChange: (checked: boolean) => void
  /** Names the setting: "My Pay", "Use schedules". Required even when hidden. */
  label: ReactNode
  /** Hide the label when the row already shows it (it still names the switch). */
  hideLabel?: boolean
  /** One line under the label saying what on means. */
  description?: ReactNode
  disabled?: boolean
  /** Shows the switch as busy and blocks taps while a save runs. */
  busy?: boolean
  className?: string
}

/**
 * An on/off setting with a 44px target. With a visible label it lays out as a
 * settings row: label and description on the left, switch on the right.
 */
export function Switch({ checked, onChange, label, hideLabel = false, description, disabled = false, busy = false, className }: SwitchProps) {
  const ids = useId()
  const button = (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={`${ids}-label`}
      aria-describedby={description ? `${ids}-description` : undefined}
      aria-busy={busy || undefined}
      disabled={disabled || busy}
      onClick={() => onChange(!checked)}
      className="group inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-60"
    >
      <span className={cx('relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-150', checked ? 'bg-primary' : 'bg-slate-300')}>
        <span className={cx('inline-block size-5 rounded-full bg-white shadow-sm transition-transform duration-150 ease-out-strong motion-reduce:transition-none', checked ? 'translate-x-[22px]' : 'translate-x-0.5')} />
      </span>
    </button>
  )

  if (hideLabel) {
    return (
      <span className={cx('inline-flex', className)}>
        <span id={`${ids}-label`} className="sr-only">{label}</span>
        {description && <span id={`${ids}-description`} className="sr-only">{description}</span>}
        {button}
      </span>
    )
  }

  return (
    <div className={cx('flex items-center justify-between gap-4', className)}>
      <div className="min-w-0">
        {/* Clicking the words flips the switch, like a native label. */}
        <span id={`${ids}-label`} onClick={() => { if (!disabled && !busy) onChange(!checked) }} className={cx('block text-body-sm font-medium text-ink', !disabled && 'cursor-pointer')}>{label}</span>
        {description && <span id={`${ids}-description`} className="mt-0.5 block text-body-sm text-ink-muted">{description}</span>}
      </div>
      {button}
    </div>
  )
}
