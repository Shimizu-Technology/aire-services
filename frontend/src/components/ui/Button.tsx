import type { ComponentPropsWithRef, ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { buttonClasses, type ButtonSize, type ButtonVariant } from './buttonStyles'

export interface ButtonProps extends ComponentPropsWithRef<'button'> {
  variant?: ButtonVariant
  size?: ButtonSize
  /** Disables the button and shows a spinner. The label stays unless `loadingLabel` is set. */
  loading?: boolean
  loadingLabel?: ReactNode
  /** Icon shown before the label. Decorative; the label names the action. */
  icon?: ReactNode
  fullWidth?: boolean
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  loadingLabel,
  icon,
  fullWidth,
  className,
  disabled,
  type = 'button',
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClasses({ variant, size, fullWidth, className })}
    >
      {loading
        ? <Loader2 aria-hidden="true" className="size-4 shrink-0 animate-spin motion-reduce:animate-none" />
        : icon && <span aria-hidden="true" className="inline-flex shrink-0">{icon}</span>}
      {loading && loadingLabel ? loadingLabel : children}
    </button>
  )
}

export interface IconButtonProps extends Omit<ComponentPropsWithRef<'button'>, 'children' | 'aria-label'> {
  /** Accessible name and hover tooltip. Required: icon-only buttons have no visible text. */
  label: string
  icon: ReactNode
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
}

export function IconButton({ label, icon, variant = 'ghost', size = 'md', loading = false, disabled, className, type = 'button', ...props }: IconButtonProps) {
  return (
    <button
      {...props}
      type={type}
      aria-label={label}
      title={props.title ?? label}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClasses({ variant, size, iconOnly: true, className })}
    >
      {loading
        ? <Loader2 aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" />
        : <span aria-hidden="true" className="inline-flex">{icon}</span>}
    </button>
  )
}
