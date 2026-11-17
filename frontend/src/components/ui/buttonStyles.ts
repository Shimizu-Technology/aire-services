import { cx } from '../../lib/cx'

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'danger-outline' | 'ghost'
export type ButtonLayout = 'label' | 'detail'
export type ButtonSize = 'sm' | 'md' | 'lg'

const base =
  'inline-flex flex-wrap max-w-full shrink-0 items-center justify-center rounded-control text-center font-semibold whitespace-normal text-balance leading-tight [overflow-wrap:anywhere] ' +
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

// Groups stretch adjacent controls; minimum heights allow enlarged labels to grow.
// Fine pointers retain compact sizes; touch targets stay at least 44px.
const sizes: Record<ButtonSize, string> = {
  sm: 'min-h-11 px-3 py-2 text-body-sm pointer-fine:min-h-9',
  md: 'min-h-11 px-4 py-2 text-body-sm',
  lg: 'min-h-12 px-5 py-2.5 text-base',
}

const iconSizes: Record<ButtonSize, string> = {
  sm: 'size-11 pointer-fine:size-9',
  md: 'size-11',
  lg: 'size-12',
}

/** Button classes for elements that can't be a `<Button>`, such as router links. */
export function buttonClasses({ variant = 'primary', size = 'md', fullWidth = false, iconOnly = false, layout = 'label', className }: {
  variant?: ButtonVariant
  size?: ButtonSize
  fullWidth?: boolean
  iconOnly?: boolean
  layout?: ButtonLayout
  className?: string
} = {}) {
  return cx(base, variants[variant], iconOnly ? iconSizes[size] : sizes[size], layout === 'detail' ? 'flex-col gap-0.5' : 'gap-2', fullWidth && 'w-full', className)
}
