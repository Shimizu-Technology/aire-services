import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { api, type AdminUser } from '../../lib/api'
import { formatDateTime } from '../../lib/dateUtils'
import { invitationOutcomeMessage } from '../../lib/invitationOutcome'
import { ROLE_DETAILS, roleLabel } from '../../lib/roles'
import { Button, buttonClasses } from '../ui'
import { firstName, isKioskLocked } from './personFormat'

export function SummaryCard({ title, editHref, children }: { title: string; editHref: string | null; children: ReactNode }) {
  return (
    <section aria-label={title} className="rounded-card border border-line bg-surface">
      <div className="flex min-h-11 items-center justify-between gap-3 border-b border-line px-4 py-2">
        <h2 className="text-body font-semibold text-ink">{title}</h2>
        {editHref && <Link to={editHref} className={buttonClasses({ variant: 'secondary', size: 'sm' })}>Edit</Link>}
      </div>
      <dl className="divide-y divide-line text-body-sm">{children}</dl>
    </section>
  )
}

export function SummaryRow({ label, children, action }: { label: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5">
      <dt className="w-40 shrink-0 text-ink-muted">{label}</dt>
      <dd className="min-w-0 flex-1 font-medium text-ink [overflow-wrap:anywhere]">{children}</dd>
      {action}
    </div>
  )
}

interface AccessSummaryProps {
  user: AdminUser
  /** Opens the Edit dialog on Team; null when the viewer can't change this person's access. */
  editHref: string | null
  myPayForEveryone: boolean | null
  onResetPin?: () => void
  /** Deletes a never-used profile (after a confirm) and leaves the page. */
  onDelete?: () => void
}

/** Role, sign-in, kiosk PIN and My Pay, read-only. Editing comes from Edit for now. */
export function AccessSummary({ user, editHref, myPayForEveryone, onResetPin, onDelete }: AccessSummaryProps) {
  const first = firstName(user)
  const [resending, setResending] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const canChange = user.can_change_access !== false
  const locked = user.kiosk_enabled && isKioskLocked(user)

  const resend = async () => {
    setResending(true)
    setNotice(null)
    const response = await api.resendInvite(user.id)
    setResending(false)
    setNotice(response.error ? response.error : invitationOutcomeMessage(response.data, true, Boolean(response.data?.message)))
  }

  const pin = !user.time_tracking_enabled || !user.kiosk_enabled
    ? 'Kiosk off'
    : locked
      ? `Locked until ${formatDateTime(user.kiosk_locked_until!)}`
      : user.kiosk_pin_configured
        ? `Set${user.kiosk_pin_last_rotated_at ? ` · changed ${formatDateTime(user.kiosk_pin_last_rotated_at)}` : ''}`
        : 'Not set yet'

  return (
    <div className="max-w-[55rem] space-y-4">
      <SummaryCard title="Access" editHref={editHref}>
        <SummaryRow label="Role">
          {roleLabel(user.role)}
          <span className="block font-normal text-ink-muted">{ROLE_DETAILS[user.role].help}</span>
        </SummaryRow>
        <SummaryRow
          label="Personal sign-in"
          action={user.is_active && user.is_pending && user.email && canChange ? (
            <Button variant="secondary" size="sm" loading={resending} onClick={() => void resend()}>Resend invite</Button>
          ) : undefined}
        >
          {user.personal_access_enabled ? (user.email || 'On') : 'Off, kiosk only'}
          {user.personal_access_enabled && user.is_pending && <span className="block font-normal text-ink-muted">Invited, hasn't signed in yet</span>}
        </SummaryRow>
        <SummaryRow
          label="Kiosk PIN"
          action={onResetPin && user.time_tracking_enabled && canChange ? (
            <Button variant="secondary" size="sm" onClick={onResetPin}>{user.kiosk_pin_configured ? 'Reset PIN' : 'Set PIN'}</Button>
          ) : undefined}
        >
          {pin}
        </SummaryRow>
        <SummaryRow label="My Pay">
          {myPayForEveryone ? 'On for everyone' : user.my_pay_enabled ? `On: ${first} sees their own paychecks` : 'Off'}
        </SummaryRow>
      </SummaryCard>
      {notice && <p role="status" className="text-body-sm text-ink">{notice}</p>}
      {!canChange && <p className="text-body-sm text-ink-muted">Only an owner can change an owner's or admin's sign-in and kiosk access.</p>}
      {onDelete && user.can_delete_permanently && canChange && (
        <section aria-label="Unused profile" className="rounded-card border border-line bg-surface px-4 py-3">
          <p className="text-body-sm text-ink">{first} has no hours or payroll history, so this profile can be deleted.</p>
          <Button variant="danger-outline" size="sm" className="mt-2" onClick={onDelete}>Delete unused profile</Button>
        </section>
      )}
    </div>
  )
}
