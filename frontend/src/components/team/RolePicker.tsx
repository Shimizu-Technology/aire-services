import { useId } from 'react'
import { ROLE_DETAILS, roleLabel, type UserRole } from '../../lib/roles'

interface RolePickerProps {
  value: UserRole
  /** Roles the viewer may choose. The current role is always shown. */
  options: UserRole[]
  onChange: (role: UserRole) => void
  /** Shown instead of the choices when options is empty. */
  lockedReason?: string
  disabled?: boolean
}

// One radio card per role with a line of help, so the choice explains itself.
// Owners see all four roles; admins see Manager and Employee.
export default function RolePicker({ value, options, onChange, lockedReason, disabled = false }: RolePickerProps) {
  const name = useId()
  const helpId = useId()

  if (options.length === 0) {
    return (
      <div>
        <p className="mb-2 block text-sm font-medium text-slate-700">Role</p>
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
          <p className="text-sm font-semibold text-slate-900">{roleLabel(value)}</p>
          <p className="mt-0.5 text-xs leading-5 text-slate-600">{ROLE_DETAILS[value]?.help}</p>
          {lockedReason && <p className="mt-2 text-xs font-medium text-slate-700">{lockedReason}</p>}
        </div>
      </div>
    )
  }

  const choices = options.includes(value) ? options : [value, ...options]

  return (
    <fieldset disabled={disabled} aria-describedby={helpId}>
      <legend className="mb-2 block text-sm font-medium text-slate-700">Role</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {choices.map((role) => {
          const selected = role === value
          const selectable = options.includes(role)
          return (
            <label
              key={role}
              className={`flex min-h-11 items-start gap-3 rounded-xl border p-3 transition ${
                selected ? 'border-cyan-500 bg-cyan-50/70 ring-2 ring-cyan-100' : 'border-slate-200 bg-white'
              } ${selectable && !disabled ? 'cursor-pointer hover:border-slate-300' : 'cursor-not-allowed opacity-70'}`}
            >
              <input
                type="radio"
                name={name}
                value={role}
                checked={selected}
                disabled={!selectable}
                onChange={() => onChange(role)}
                className="mt-0.5 h-4 w-4 shrink-0 border-slate-300 text-cyan-600 focus:ring-cyan-500"
              />
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-slate-900">{ROLE_DETAILS[role].label}</span>
                <span className="mt-0.5 block text-xs leading-5 text-slate-600">{ROLE_DETAILS[role].help}</span>
              </span>
            </label>
          )
        })}
      </div>
      <p id={helpId} className="mt-2 text-xs text-slate-500">
        {options.includes('owner')
          ? 'Owners, admins and managers always sign in personally.'
          : 'Only an owner can make someone an admin or owner. Managers always sign in personally.'}
      </p>
    </fieldset>
  )
}
