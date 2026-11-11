import { useId, type ComponentPropsWithRef, type ReactNode } from 'react'
import { cx } from '../../lib/cx'
import { FieldContext, useFieldContext } from './fieldContext'

export interface FieldProps {
  label: ReactNode
  /** Short guidance shown under the control and read with it. */
  help?: ReactNode
  /** Shown in red, marks the control invalid, and is read with it. */
  error?: ReactNode
  required?: boolean
  /** Hide the label visually; it stays the control's accessible name. */
  labelHidden?: boolean
  /** Sits beside the label, e.g. a `<HelpTip>`. Kept outside the `<label>`. */
  labelAction?: ReactNode
  /** Use when the control needs a specific id. */
  id?: string
  className?: string
  children: ReactNode
}

/**
 * Labels one `Input`, `Select` or `Textarea` and ties help and error text to it.
 *
 *   <Field label="Email" help="We send the invite here." error={errors.email}>
 *     <Input type="email" value={email} onChange={...} />
 *   </Field>
 */
export function Field({ label, help, error, required = false, labelHidden = false, labelAction, id, className, children }: FieldProps) {
  const generated = useId()
  const controlId = id ?? `${generated}-control`
  const helpId = help ? `${controlId}-help` : undefined
  const errorId = error ? `${controlId}-error` : undefined
  const describedBy = [errorId, helpId].filter(Boolean).join(' ') || undefined

  return (
    <FieldContext.Provider value={{ id: controlId, describedBy, invalid: Boolean(error), required }}>
      <div className={cx('min-w-0', className)}>
        <div className={cx('mb-1.5 flex items-center gap-1.5', labelHidden && !labelAction && 'sr-only')}>
          <label htmlFor={controlId} className={cx('text-body-sm font-medium text-ink', labelHidden && 'sr-only')}>
            {label}
            {required && <span aria-hidden="true" className="text-danger"> *</span>}
          </label>
          {labelAction}
        </div>
        {children}
        {error && <p id={errorId} className="mt-1.5 text-body-sm font-medium text-danger">{error}</p>}
        {help && <p id={helpId} className="mt-1.5 text-caption text-ink-subtle">{help}</p>}
      </div>
    </FieldContext.Provider>
  )
}

// 16px on touch so iOS doesn't zoom; 14px with a mouse. 44px tall.
const control =
  'block w-full min-h-11 rounded-control border border-line-strong bg-surface px-3 text-body text-ink ' +
  'placeholder:text-ink-subtle pointer-fine:text-body-sm ' +
  'focus:border-primary aria-invalid:border-danger ' +
  'disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-ink-subtle'

function useControlProps<T extends { id?: string; required?: boolean; 'aria-describedby'?: string; 'aria-invalid'?: boolean | 'true' | 'false' | 'grammar' | 'spelling' }>(props: T) {
  const field = useFieldContext()
  const describedBy = [field?.describedBy, props['aria-describedby']].filter(Boolean).join(' ') || undefined
  return {
    ...props,
    id: props.id ?? field?.id,
    required: props.required ?? field?.required,
    'aria-describedby': describedBy,
    'aria-invalid': props['aria-invalid'] ?? (field?.invalid || undefined),
  }
}

export function Input({ className, ...props }: ComponentPropsWithRef<'input'>) {
  return <input {...useControlProps(props)} className={cx(control, className)} />
}

export function Select({ className, children, ...props }: ComponentPropsWithRef<'select'>) {
  return (
    <select {...useControlProps(props)} className={cx(control, 'pr-8', className)}>
      {children}
    </select>
  )
}

export function Textarea({ className, rows = 3, ...props }: ComponentPropsWithRef<'textarea'>) {
  return <textarea rows={rows} {...useControlProps(props)} className={cx(control, 'py-2.5', className)} />
}
