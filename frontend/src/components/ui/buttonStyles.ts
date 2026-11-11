import { cx } from '../../lib/cx'

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'danger-outline' | 'ghost'
export type ButtonSize = 'sm' | 'md' | 'lg'

const base =
  'inline-flex items-center justify-center gap-2 rounded-control font-semibold whitespace-nowrap ' +
  'transition duration-(--dur-press) ease-out-strong active:scale-[0.97] motion-reduce:active:scale-100 ' +
  'disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100 aria-busy:cursor-progress'

// One primary colour: AIRE navy. Green is for status, never for buttons.
const variants: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-white hover:bg-primary-dark',
  secondary: 'border border-line-strong bg-surface text-ink hover:bg-surface-muted',
  danger: 'bg-danger text-white hover:bg-danger-dark',
  'danger-outline': 'border border-red-300 bg-surface text-danger hover:bg-danger-soft',
  ghost: 'text-primary hover:bg-primary/5',
}

// Every size is at least 44px tall on touch screens. `sm` drops to 36px only
// with a mouse or trackpad.
const sizes: Record<ButtonSize, string> = {
  sm: 'min-h-11 px-3 text-sm pointer-fine:min-h-9',
  md: 'min-h-11 px-4 text-sm',
  lg: 'min-h-12 px-5 text-base',
}

const iconSizes: Record<ButtonSize, string> = {
  sm: 'size-11 pointer-fine:size-9',
  md: 'size-11',
  lg: 'size-12',
}

/** Button classes for elements that can't be a `<Button>`, such as router links. */
export function buttonClasses({ variant = 'primary', size = 'md', fullWidth = false, iconOnly = false, className }: {
  variant?: ButtonVariant
  size?: ButtonSize
  fullWidth?: boolean
  iconOnly?: boolean
  className?: string
} = {}) {
  return cx(base, variants[variant], iconOnly ? iconSizes[size] : sizes[size], fullWidth && 'w-full', className)
}
