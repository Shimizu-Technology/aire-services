import { useId } from 'react'
import { Link } from 'react-router-dom'
import { ROLE_DETAILS, type UserRole } from '../../lib/roles'

export function RoleCards({ value, options, viewerRole, self, disabled, onChange }: {
  value: UserRole; options: UserRole[]; viewerRole: UserRole | null; self: boolean; disabled: boolean; onChange: (value: UserRole) => void
}) {
  const name = useId()
  const roles: UserRole[] = ['employee', 'manager', 'admin', ...(viewerRole === 'owner' ? ['owner' as const] : [])]
  return <fieldset disabled={disabled} className="space-y-3">
    <legend className="text-body font-semibold">Role</legend>
    {value === 'owner' && viewerRole !== 'owner' && <p className="text-body-sm">Current role: Owner</p>}
    <div className="grid gap-2 sm:grid-cols-2">
      {roles.map(role => <label key={role} className={`flex min-h-11 items-start gap-3 rounded-control border p-3 ${value === role ? 'border-primary bg-primary/5' : 'border-line'} ${!options.includes(role) ? 'text-ink-subtle' : 'cursor-pointer'}`}>
        <input type="radio" className="mt-1 size-4 shrink-0 accent-primary" name={name} value={role} checked={value === role}
          disabled={!options.includes(role)} onChange={() => onChange(role)} />
        <span className="min-w-0"><span className="block text-body-sm font-semibold">{ROLE_DETAILS[role].label}</span>
          <span className="mt-1 block text-body-sm text-ink-muted">{ROLE_DETAILS[role].help}</span></span>
      </label>)}
    </div>
    <p className="text-body-sm text-ink-muted">{self ? "You can't change your own role." : viewerRole === 'owner'
      ? 'Owners can assign any role. AIRE must keep an active owner with personal sign-in.'
      : 'Only an owner can assign or change admin and owner roles.'}</p>
    <Link className="inline-flex min-h-11 items-center text-body-sm font-semibold text-primary hover:underline" to="/admin/settings/roles">See what each role can do</Link>
  </fieldset>
}
