import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../../lib/api'
import type { AdminUser } from '../../lib/api'
import { formatDateTime } from '../../lib/dateUtils'
import { FadeUp } from '../../components/ui/MotionComponents'

type StatusFilter = 'all' | 'active' | 'pending'
type RoleFilter = 'all' | 'admin' | 'employee'

export default function Users() {
  useEffect(() => {
    document.title = 'Users | AIRE Ops'
  }, [])

  const [users, setUsers] = useState<AdminUser[]>([])
  const [loading, setLoading] = useState(true)
  const [showInviteModal, setShowInviteModal] = useState(false)
  const [inviteFirstName, setInviteFirstName] = useState('')
  const [inviteLastName, setInviteLastName] = useState('')
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<'admin' | 'employee'>('employee')
  const [inviting, setInviting] = useState(false)
  const [error, setError] = useState('')
  const [resendingIds, setResendingIds] = useState<Set<number>>(new Set())
  const [deletingIds, setDeletingIds] = useState<Set<number>>(new Set())
  const [updatingRoleIds, setUpdatingRoleIds] = useState<Set<number>>(new Set())
  const [resettingPinIds, setResettingPinIds] = useState<Set<number>>(new Set())
  const [searchQuery, setSearchQuery] = useState('')
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [contactEmailsInput, setContactEmailsInput] = useState('')
  const [contactSettingsLoading, setContactSettingsLoading] = useState(true)
  const [contactSettingsSaving, setContactSettingsSaving] = useState(false)
  const [contactSettingsMessage, setContactSettingsMessage] = useState<string | null>(null)
  const modalRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (showInviteModal && modalRef.current) {
      const firstInput = modalRef.current.querySelector<HTMLElement>('input, select, textarea')
      if (firstInput) setTimeout(() => firstInput.focus(), 0)
    }
  }, [showInviteModal])

  const fetchUsers = useCallback(async () => {
    setLoading(true)
    try {
      const response = await api.getAdminUsers()
      if (response.data) {
        setUsers(response.data.users.filter((user) => user.role === 'admin' || user.role === 'employee'))
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchUsers()
  }, [fetchUsers])

  const fetchContactSettings = useCallback(async () => {
    setContactSettingsLoading(true)
    try {
      const response = await api.getContactSettings()
      if (response.data) {
        setContactEmailsInput(response.data.contact_notification_emails.join(', '))
      } else if (response.error) {
        setContactSettingsMessage(response.error)
      }
    } finally {
      setContactSettingsLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchContactSettings()
  }, [fetchContactSettings])

  const resetInviteForm = () => {
    setInviteFirstName('')
    setInviteLastName('')
    setInviteEmail('')
    setInviteRole('employee')
    setError('')
  }

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setInviting(true)

    try {
      const response = await api.inviteUser({
        email: inviteEmail,
        first_name: inviteFirstName,
        last_name: inviteLastName || undefined,
        role: inviteRole,
      })
      if (response.error) {
        setError(response.error)
      } else {
        setShowInviteModal(false)
        resetInviteForm()
        fetchUsers()
      }
    } catch {
      setError('Failed to invite team member')
    } finally {
      setInviting(false)
    }
  }

  const handleRoleChange = async (userId: number, newRole: 'admin' | 'employee') => {
    setUpdatingRoleIds((prev) => new Set(prev).add(userId))
    try {
      const response = await api.updateUserRole(userId, newRole)
      if (response.error) {
        alert(response.error)
      } else {
        fetchUsers()
      }
    } catch {
      alert('Failed to update role')
    } finally {
      setUpdatingRoleIds((prev) => {
        const next = new Set(prev)
        next.delete(userId)
        return next
      })
    }
  }

  const handleDelete = async (user: AdminUser) => {
    if (!confirm(`Remove ${user.display_name || user.email} from AIRE Ops access?`)) return

    setDeletingIds((prev) => new Set(prev).add(user.id))
    try {
      const response = await api.deleteUser(user.id)
      if (response.error) {
        alert(response.error)
      } else {
        fetchUsers()
      }
    } catch {
      alert('Failed to remove team member')
    } finally {
      setDeletingIds((prev) => {
        const next = new Set(prev)
        next.delete(user.id)
        return next
      })
    }
  }

  const handleResendInvite = async (user: AdminUser) => {
    setResendingIds((prev) => new Set(prev).add(user.id))
    try {
      const response = await api.resendInvite(user.id)
      if (response.error) {
        alert(response.error)
      } else {
        alert(`Invitation re-sent to ${user.email}`)
      }
    } catch {
      alert('Failed to resend invite')
    } finally {
      setResendingIds((prev) => {
        const next = new Set(prev)
        next.delete(user.id)
        return next
      })
    }
  }

  const handleResetKioskPin = async (user: AdminUser) => {
    const customPin = prompt(`Set a custom 4-8 digit kiosk PIN for ${user.display_name || user.email}.\nLeave blank to auto-generate one.`)?.trim()
    if (customPin === null) return

    setResettingPinIds((prev) => new Set(prev).add(user.id))
    try {
      const response = await api.resetKioskPin(user.id, customPin || undefined)
      if (response.error || !response.data) {
        alert(response.error || 'Failed to reset kiosk PIN')
      } else {
        alert(`Kiosk PIN for ${user.full_name}: ${response.data.kiosk_pin}`)
        fetchUsers()
      }
    } catch {
      alert('Failed to reset kiosk PIN')
    } finally {
      setResettingPinIds((prev) => {
        const next = new Set(prev)
        next.delete(user.id)
        return next
      })
    }
  }

  const handleSaveContactSettings = async () => {
    const emails = contactEmailsInput
      .split(/[\n,;]+/)
      .map((value) => value.trim())
      .filter(Boolean)

    setContactSettingsSaving(true)
    setContactSettingsMessage(null)

    try {
      const response = await api.updateContactSettings(emails)
      if (response.error) {
        setContactSettingsMessage(response.error)
      } else if (response.data) {
        setContactEmailsInput(response.data.contact_notification_emails.join(', '))
        setContactSettingsMessage(response.data.message || 'Notification recipients updated')
      }
    } finally {
      setContactSettingsSaving(false)
    }
  }

  const visibleUsers = useMemo(() => {
    return users.filter((user) => {
      const matchesSearch = `${user.full_name || ''} ${user.display_name || ''} ${user.email}`.toLowerCase().includes(searchQuery.trim().toLowerCase())
      const matchesRole = roleFilter === 'all' ? true : user.role === roleFilter
      const matchesStatus = statusFilter === 'all'
        ? true
        : statusFilter === 'pending'
          ? user.is_pending
          : !user.is_pending

      return matchesSearch && matchesRole && matchesStatus
    })
  }, [roleFilter, searchQuery, statusFilter, users])

  const totalAdmins = users.filter((u) => u.role === 'admin').length
  const pendingInvites = users.filter((u) => u.is_pending).length
  const kioskConfigured = users.filter((u) => u.kiosk_pin_configured).length

  return (
    <div className="space-y-6">
      <FadeUp>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">Team Access</h1>
            <p className="mt-1 text-sm text-slate-600">Manage staff roles, invitation state, and kiosk access so the AIRE ops side stays secure and usable.</p>
          </div>
          <button
            onClick={() => setShowInviteModal(true)}
            className="inline-flex items-center justify-center rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800"
          >
            Invite Team Member
          </button>
        </div>
      </FadeUp>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="text-sm text-slate-500">Total Team Members</div>
          <div className="mt-2 text-3xl font-bold text-slate-900">{users.length}</div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="text-sm text-slate-500">Admins</div>
          <div className="mt-2 text-3xl font-bold text-cyan-700">{totalAdmins}</div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="text-sm text-slate-500">Pending Invites</div>
          <div className="mt-2 text-3xl font-bold text-amber-600">{pendingInvites}</div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="text-sm text-slate-500">Kiosk PIN Configured</div>
          <div className="mt-2 text-3xl font-bold text-slate-900">{kioskConfigured}</div>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Website Inquiry Notifications</h2>
            <p className="mt-1 max-w-2xl text-sm text-slate-600">
              Public contact-form submissions are emailed immediately. They are not stored in an admin inbox yet, so add the recipient emails here to make sure the right people get notified.
            </p>
          </div>
          <button
            onClick={handleSaveContactSettings}
            disabled={contactSettingsSaving || contactSettingsLoading}
            className="inline-flex items-center justify-center rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
          >
            {contactSettingsSaving ? 'Saving...' : 'Save Notification Emails'}
          </button>
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-[1.4fr_auto] lg:items-start">
          <textarea
            value={contactEmailsInput}
            onChange={(e) => setContactEmailsInput(e.target.value)}
            rows={3}
            placeholder="admin@aireservicesguam.com, ops@aireservicesguam.com"
            className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-100"
          />
          <div className="rounded-xl border border-cyan-100 bg-cyan-50 px-4 py-3 text-sm text-cyan-800">
            Separate multiple recipients with commas, semicolons, or new lines.
          </div>
        </div>

        {contactSettingsMessage && (
          <div
            className={`mt-3 rounded-xl border px-4 py-3 text-sm ${
              contactSettingsMessage.toLowerCase().includes('invalid') ||
              contactSettingsMessage.toLowerCase().includes('error')
                ? 'border-red-200 bg-red-50 text-red-700'
                : 'border-emerald-200 bg-emerald-50 text-emerald-700'
            }`}
          >
            {contactSettingsMessage}
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid gap-3 lg:grid-cols-[1.4fr,0.8fr,0.8fr]">
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by name or email"
            className="rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-100"
          />
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value as RoleFilter)}
            className="rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-100"
          >
            <option value="all">All roles</option>
            <option value="admin">Admins only</option>
            <option value="employee">Employees only</option>
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            className="rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-100"
          >
            <option value="all">All access states</option>
            <option value="active">Active only</option>
            <option value="pending">Pending invites only</option>
          </select>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 className="text-lg font-semibold text-slate-900">AIRE Team</h2>
          <p className="mt-1 text-sm text-slate-500">Roles, invitation state, and kiosk access for staff users.</p>
        </div>

        {loading ? (
          <div className="px-5 py-10 text-center text-sm text-slate-500">Loading team members...</div>
        ) : users.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-slate-500">No team members yet. Invite your first admin or employee to get AIRE Ops started.</div>
        ) : visibleUsers.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-slate-500">No team members match the current filters.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px]">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Team Member</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Role</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Access</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Kiosk</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Joined</th>
                  <th className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {visibleUsers.map((user) => (
                  <tr key={user.id} className="hover:bg-slate-50/80">
                    <td className="px-5 py-4">
                      <div className="font-medium text-slate-900">{user.full_name || user.display_name || user.email}</div>
                      <div className="mt-1 text-sm text-slate-500">{user.email}</div>
                    </td>
                    <td className="px-5 py-4">
                      <select
                        value={user.role}
                        onChange={(e) => handleRoleChange(user.id, e.target.value as 'admin' | 'employee')}
                        disabled={updatingRoleIds.has(user.id)}
                        className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-100"
                      >
                        <option value="admin">Admin</option>
                        <option value="employee">Employee</option>
                      </select>
                    </td>
                    <td className="px-5 py-4">
                      {user.is_pending ? (
                        <span className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">Pending Invite</span>
                      ) : (
                        <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">Active</span>
                      )}
                    </td>
                    <td className="px-5 py-4">
                      <div className="space-y-1 text-sm">
                        <div>
                          {user.kiosk_pin_configured ? (
                            <span className="inline-flex rounded-full border border-cyan-200 bg-cyan-50 px-2.5 py-1 text-xs font-medium text-cyan-700">Configured</span>
                          ) : (
                            <span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-600">Not Set</span>
                          )}
                        </div>
                        {user.kiosk_pin_last_rotated_at && <div className="text-xs text-slate-500">Rotated {formatDateTime(user.kiosk_pin_last_rotated_at)}</div>}
                        {user.kiosk_locked_until && <div className="text-xs text-red-600">Locked until {formatDateTime(user.kiosk_locked_until)}</div>}
                      </div>
                    </td>
                    <td className="px-5 py-4 text-sm text-slate-500">{formatDateTime(user.created_at)}</td>
                    <td className="px-5 py-4">
                      <div className="flex justify-end gap-3 text-sm font-medium">
                        <button
                          onClick={() => handleResetKioskPin(user)}
                          disabled={resettingPinIds.has(user.id)}
                          className="text-cyan-700 transition hover:text-cyan-900 disabled:opacity-50"
                        >
                          {resettingPinIds.has(user.id) ? 'Resetting PIN...' : 'Reset Kiosk PIN'}
                        </button>
                        {user.is_pending && (
                          <button
                            onClick={() => handleResendInvite(user)}
                            disabled={resendingIds.has(user.id)}
                            className="text-slate-700 transition hover:text-slate-900 disabled:opacity-50"
                          >
                            {resendingIds.has(user.id) ? 'Sending...' : 'Resend Invite'}
                          </button>
                        )}
                        <button
                          onClick={() => handleDelete(user)}
                          disabled={deletingIds.has(user.id)}
                          className="text-red-600 transition hover:text-red-800 disabled:opacity-50"
                        >
                          {deletingIds.has(user.id) ? 'Removing...' : 'Remove'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showInviteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div ref={modalRef} className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold text-slate-900">Invite Team Member</h2>
                <p className="mt-1 text-sm text-slate-500">Create staff access for the AIRE admin/ops side.</p>
              </div>
              <button onClick={() => { setShowInviteModal(false); resetInviteForm() }} className="rounded-lg px-2 py-1 text-slate-500 hover:bg-slate-100">✕</button>
            </div>

            <form onSubmit={handleInvite} className="mt-6 space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-700">First Name</label>
                  <input value={inviteFirstName} onChange={(e) => setInviteFirstName(e.target.value)} className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-100" required />
                </div>
                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-700">Last Name</label>
                  <input value={inviteLastName} onChange={(e) => setInviteLastName(e.target.value)} className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-100" />
                </div>
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700">Email</label>
                <input type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-100" required />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700">Role</label>
                <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value as 'admin' | 'employee')} className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-100">
                  <option value="employee">Employee</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => { setShowInviteModal(false); resetInviteForm() }} className="rounded-xl border border-slate-300 px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50">Cancel</button>
                <button type="submit" disabled={inviting} className="rounded-xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50">
                  {inviting ? 'Inviting...' : 'Send Invite'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
