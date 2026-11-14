import { useState } from 'react'
import { useAuthContext } from '../../contexts/AuthContext'
import { api, type AdminUser } from '../../lib/api'
import { invitationOutcomeMessage } from '../../lib/invitationOutcome'
import { isKioskLocked } from './personFormat'
import { roleLabel, roleRequiresPersonalAccess } from '../../lib/roles'
import { Button, Field, Input, Switch, UnsavedChangesBar, blockPathOrParams, useUnsavedChanges } from '../ui'
import { RoleCards } from './RoleCards'
import { usePersonEdit } from './usePersonEdit'
import { EditError } from './EditError'

export function AccessTab({ user, myPayForEveryone, myPayError, onResetPin, onDelete, onSaved }: {
  user: AdminUser; myPayForEveryone: boolean | null; myPayError: string | null; onResetPin?: () => void; onDelete: () => void; onSaved: (user: AdminUser, pin?: string | null) => void
}) {
  const { currentUser, userRole } = useAuthContext()
  const [role, setRole] = useState(user.role)
  const [personal, setPersonal] = useState(user.personal_access_enabled)
  const [email, setEmail] = useState(user.email || '')
  const [myPay, setMyPay] = useState(Boolean(user.my_pay_enabled))
  const [sendInvite, setSendInvite] = useState(false)
  const [notice, setNotice] = useState('')
  const [resending, setResending] = useState(false)
  const edit = usePersonEdit(user, onSaved)
  const ended = user.employment_status === 'terminated'
  const self = currentUser?.id === user.id
  const accessLocked = user.can_change_access === false || ended
  const dirty = sendInvite || role !== user.role || personal !== user.personal_access_enabled || email !== (user.email || '') || myPay !== Boolean(user.my_pay_enabled)
  const discard = () => { setRole(user.role); setPersonal(user.personal_access_enabled); setEmail(user.email || ''); setMyPay(Boolean(user.my_pay_enabled)); setSendInvite(false); edit.setError('') }
  const save = () => void edit.save({ role, personal_access_enabled: personal, ...(email !== (user.email || '') ? { email: email.trim() || null } : {}), my_pay_enabled: myPay, send_invitation: personal && sendInvite,
    ...(!personal ? { first_name: user.first_name || user.full_name || user.display_name, last_name: user.last_name || '' } : {}) })
  const unsaved = useUnsavedChanges({ dirty, onSave: save, onDiscard: discard, saving: edit.saving,
    shouldBlock: blockPathOrParams('tab'), what: 'Access', saveLabel: 'Save', saveDisabled: edit.conflict || ended,
    summary: role !== user.role ? `Role: ${roleLabel(user.role)} → ${roleLabel(role)}` : 'Sign-in and My Pay' })
  const resend = async () => {
    setResending(true)
    const response = await api.resendInvite(user.id)
    setResending(false)
    setNotice(response.error || invitationOutcomeMessage(response.data, true, Boolean(response.data?.message)))
  }
  return <div className="max-w-[55rem] space-y-4 pb-24 lg:pb-0">
    <section className="space-y-4 rounded-card border border-line bg-surface p-4">
      <RoleCards value={role} options={ended ? [] : user.assignable_roles ?? []} viewerRole={userRole} self={self} disabled={edit.saving || ended}
        onChange={next => { setRole(next); if (roleRequiresPersonalAccess(next)) setPersonal(true) }} />
    </section>
    <section aria-label="Signing in" className="space-y-4 rounded-card border border-line bg-surface p-4">
      <h2 className="text-body font-semibold">Signing in</h2>
      <Switch checked={personal} onChange={setPersonal} label="Personal sign-in" disabled={accessLocked || self || roleRequiresPersonalAccess(role) || (!user.time_tracking_enabled && personal) || edit.saving}
        description={self ? "You can't turn off your own sign-in." : roleRequiresPersonalAccess(role) ? 'Owners, admins and managers must sign in personally.' : !user.time_tracking_enabled ? 'Enable Tracks work hours in Employment before making this a kiosk-only account.' : 'Use their own account as well as the shared kiosk.'} />
      <Field label="Email" help={user.has_clerk_account && !user.is_pending ? 'Activated accounts update their email in Clerk.' : 'An email is required for personal sign-in.'}>
        <Input type="email" value={email} disabled={accessLocked || !personal || (user.has_clerk_account && !user.is_pending) || edit.saving} onChange={event => setEmail(event.target.value)} />
      </Field>
      {personal && (user.is_pending || !user.has_clerk_account) && !accessLocked && <Switch label="Send invitation when saved" checked={sendInvite} onChange={setSendInvite} disabled={edit.saving} />}
      {user.is_pending && user.personal_access_enabled && !accessLocked && <Button variant="secondary" loading={resending} disabled={dirty} onClick={() => void resend()}>Resend invite</Button>}
      {accessLocked && !ended && <p className="text-body-sm text-ink-muted">Only an owner can change an owner's or admin's sign-in and kiosk access.</p>}
      {ended && <p className="text-body-sm text-ink-muted">Employment ended. Reactivate from Employment before changing access.</p>}
    </section>
    <section aria-label="Kiosk and pay" className="space-y-4 rounded-card border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-body-sm"><h2 className="font-semibold">Kiosk PIN</h2><p className="text-ink-muted">{!user.kiosk_enabled ? 'Kiosk off' : isKioskLocked(user) ? 'PIN locked' : user.kiosk_pin_configured ? 'PIN set' : 'Not set yet'}</p></div>
        {onResetPin && <Button variant="secondary" disabled={dirty || edit.saving} onClick={onResetPin}>{user.kiosk_pin_configured ? 'Reset PIN' : 'Set PIN'}</Button>}
      </div>
      {dirty && onResetPin && <p className="text-body-sm text-ink-muted">Save or discard changes before resetting the PIN.</p>}
      <Switch checked={myPay || Boolean(myPayForEveryone)} onChange={setMyPay} label="My Pay" disabled={ended || edit.saving || myPayForEveryone !== false}
        description={myPayForEveryone ? 'On for everyone. Change that setting on Team to turn it off for one person.' : (myPayError ? "Unknown: the setting for everyone didn't load" : null) || (myPayForEveryone === null ? 'Checking the setting for everyone…' : 'They can see their own paychecks.')} />
    </section>
    {/* Preserve the unused-profile deletion control without duplicating the old summary. */}
    {user.can_delete_permanently && !accessLocked && <Button variant="danger-outline" onClick={onDelete}>Delete unused profile</Button>}
    {notice && <p role="status" className="text-body-sm">{notice}</p>}
    <EditError error={edit.error} conflict={edit.conflict} busy={edit.saving} onReload={() => void edit.reload()} />
    <UnsavedChangesBar {...unsaved.barProps} />{unsaved.guard}
  </div>
}
