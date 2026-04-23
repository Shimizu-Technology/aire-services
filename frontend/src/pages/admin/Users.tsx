import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../../lib/api'
import type { AdminUser, AdminTimeCategory, ApprovalGroup } from '../../lib/api'
import { formatDateTime } from '../../lib/dateUtils'
import { FadeUp } from '../../components/ui/MotionComponents'

const approvalGroupOptions: Array<{ value: ApprovalGroup; label: string }> = [
  { value: 'cfi', label: 'CFI' },
  { value: 'ops_maintenance', label: 'Ops / Maintenance' },
]

export default function Users() {
  useEffect(() => {
    document.title = 'Users | AIRE Ops'
  }, [])

  const [users, setUsers] = useState<AdminUser[]>([])
  const [allCategories, setAllCategories] = useState<AdminTimeCategory[]>([])
  const [loading, setLoading] = useState(true)

  const [showCreateModal, setShowCreateModal] = useState(false)
  const [createFirstName, setCreateFirstName] = useState('')
  const [createLastName, setCreateLastName] = useState('')
  const [createEmail, setCreateEmail] = useState('')
  const [createRole, setCreateRole] = useState<'admin' | 'employee'>('employee')
  const [createApprovalGroup, setCreateApprovalGroup] = useState<ApprovalGroup | ''>('')
  const [sendInvitationEmail, setSendInvitationEmail] = useState(true)
  const [createCategoryIds, setCreateCategoryIds] = useState<Set<number>>(new Set())
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')

  const [editingUser, setEditingUser] = useState<AdminUser | null>(null)
  const [editCategoryIds, setEditCategoryIds] = useState<Set<number>>(new Set())
  const [savingCategories, setSavingCategories] = useState(false)

  const [resendingIds, setResendingIds] = useState<Set<number>>(new Set())
  const [deletingIds, setDeletingIds] = useState<Set<number>>(new Set())
  const [updatingRoleIds, setUpdatingRoleIds] = useState<Set<number>>(new Set())
  const [updatingApprovalGroupIds, setUpdatingApprovalGroupIds] = useState<Set<number>>(new Set())
  const [resettingPinIds, setResettingPinIds] = useState<Set<number>>(new Set())
  const createModalRef = useRef<HTMLDivElement>(null)
  const editModalRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (showCreateModal && createModalRef.current) {
      const first = createModalRef.current.querySelector<HTMLElement>('input, select, textarea')
      if (first) setTimeout(() => first.focus(), 0)
    }
  }, [showCreateModal])

  const applyFetchedData = useCallback((usersRes: Awaited<ReturnType<typeof api.getAdminUsers>>, catsRes: Awaited<ReturnType<typeof api.getAdminTimeCategories>>) => {
    if (usersRes.data) setUsers(usersRes.data.users.filter((u) => u.role === 'admin' || u.role === 'employee'))
    else if (usersRes.error) console.error('Failed to refresh users:', usersRes.error)
    if (catsRes.data) setAllCategories(catsRes.data.time_categories)
    else if (catsRes.error) console.error('Failed to refresh categories:', catsRes.error)
  }, [])

  useEffect(() => {
    let cancelled = false
    async function initialLoad() {
      setLoading(true)
      try {
        const [usersRes, catsRes] = await Promise.all([api.getAdminUsers(), api.getAdminTimeCategories()])
        if (!cancelled) applyFetchedData(usersRes, catsRes)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    initialLoad()
    return () => { cancelled = true }
  }, [applyFetchedData])

  const refreshData = useCallback(async () => {
    const [usersRes, catsRes] = await Promise.all([api.getAdminUsers(), api.getAdminTimeCategories()])
    applyFetchedData(usersRes, catsRes)
  }, [applyFetchedData])

  const activeCategories = allCategories.filter((c) => c.is_active)

  const resetCreateForm = () => {
    setCreateFirstName('')
    setCreateLastName('')
    setCreateEmail('')
    setCreateRole('employee')
    setCreateApprovalGroup('')
    setSendInvitationEmail(true)
    setCreateCategoryIds(new Set())
    setCreateError('')
  }

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    setCreateError('')
    setCreating(true)

    try {
      const response = await api.inviteUser({
        email: createEmail.trim() || undefined,
        first_name: createFirstName.trim(),
        last_name: createLastName.trim() || undefined,
        role: createRole,
        approval_group: createApprovalGroup || undefined,
        send_invitation: sendInvitationEmail && !!createEmail.trim(),
        time_category_ids: Array.from(createCategoryIds),
      })
      if (response.error) {
        setCreateError(response.error)
      } else {
        const sent = response.data?.invitation_email_sent
        if (sendInvitationEmail && createEmail.trim() && sent === false) {
          alert('Team member created, but the invitation email could not be sent.')
        } else if (!sendInvitationEmail || !createEmail.trim()) {
          alert('Team member added. Set their kiosk PIN so they can clock in.')
        }
        setShowCreateModal(false)
        resetCreateForm()
        refreshData()
      }
    } catch {
      setCreateError('Failed to create team member')
    } finally {
      setCreating(false)
    }
  }

  const openEditCategories = (user: AdminUser) => {
    setEditingUser(user)
    setEditCategoryIds(new Set(user.time_category_ids ?? []))
  }

  const handleSaveCategories = async () => {
    if (!editingUser) return
    setSavingCategories(true)

    try {
      const res = await api.updateUser(editingUser.id, {
        time_category_ids: Array.from(editCategoryIds),
      })
      if (res.error) {
        alert(res.error)
      } else {
        setEditingUser(null)
        refreshData()
      }
    } finally {
      setSavingCategories(false)
    }
  }

  const handleRoleChange = async (userId: number, newRole: 'admin' | 'employee') => {
    setUpdatingRoleIds((prev) => new Set(prev).add(userId))
    try {
      const response = await api.updateUserRole(userId, newRole)
      if (response.error) alert(response.error)
      else refreshData()
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

  const handleApprovalGroupChange = async (userId: number, newApprovalGroup: ApprovalGroup | '') => {
    setUpdatingApprovalGroupIds((prev) => new Set(prev).add(userId))
    try {
      const response = await api.updateUser(userId, {
        approval_group: newApprovalGroup || null,
      })
      if (response.error) alert(response.error)
      else refreshData()
    } catch {
      alert('Failed to update approval group')
    } finally {
      setUpdatingApprovalGroupIds((prev) => {
        const next = new Set(prev)
        next.delete(userId)
        return next
      })
    }
  }

  const handleDelete = async (user: AdminUser) => {
    if (!confirm(`Remove ${user.display_name || user.email || 'this user'} from AIRE Ops access?`)) return
    setDeletingIds((prev) => new Set(prev).add(user.id))
    try {
      const response = await api.deleteUser(user.id)
      if (response.error) alert(response.error)
      else refreshData()
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
      if (response.error) alert(response.error)
      else alert(`Invitation re-sent to ${user.email}`)
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
    const customPin = prompt(`Set a custom 4-8 digit kiosk PIN for ${user.display_name || user.email || user.full_name}.\nLeave blank to auto-generate one.`)?.trim()
    if (customPin === null) return
    setResettingPinIds((prev) => new Set(prev).add(user.id))
    try {
      const response = await api.resetKioskPin(user.id, customPin || undefined)
      if (response.error || !response.data) {
        alert(response.error || 'Failed to reset kiosk PIN')
      } else {
        alert(`Kiosk PIN for ${user.full_name}: ${response.data.kiosk_pin}`)
        refreshData()
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

  function toggleCategoryId(set: Set<number>, setter: (s: Set<number>) => void, id: number) {
    const next = new Set(set)
    if (next.has(id)) { next.delete(id) } else { next.add(id) }
    setter(next)
  }

  return (
    <div className="space-y-6">
      <FadeUp>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">Team Access</h1>
            <p className="mt-1 text-sm text-slate-600">
              Manage staff roles, work categories, and kiosk PIN access for AIRE Ops.
            </p>
          </div>
          <button
            onClick={() => setShowCreateModal(true)}
            className="inline-flex items-center justify-center rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
          >
            Add team member
          </button>
        </div>
      </FadeUp>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="text-sm text-slate-500">Total Team Members</div>
          <div className="mt-2 text-3xl font-bold text-slate-900">{users.length}</div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="text-sm text-slate-500">Admins</div>
          <div className="mt-2 text-3xl font-bold text-cyan-700">{users.filter((u) => u.role === 'admin').length}</div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="text-sm text-slate-500">CFI Review Group</div>
          <div className="mt-2 text-3xl font-bold text-slate-900">{users.filter((u) => u.approval_group === 'cfi').length}</div>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 className="text-lg font-semibold text-slate-900">AIRE Team</h2>
          <p className="mt-1 text-sm text-slate-500">Roles, work categories, and kiosk access.</p>
        </div>

        {loading ? (
          <div className="px-5 py-10 text-center text-sm text-slate-500">Loading team members...</div>
        ) : users.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-slate-500">No team members yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1080px]">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Team Member</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Role</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Approval Group</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Work Categories</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Status</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Kiosk</th>
                  <th className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {users.map((user) => (
                  <tr key={user.id} className="hover:bg-slate-50/80">
                    <td className="px-5 py-4">
                      <div className="font-medium text-slate-900">{user.full_name || user.display_name}</div>
                      {user.email && <div className="mt-1 text-sm text-slate-500">{user.email}</div>}
                      {!user.email && <div className="mt-1 text-xs italic text-slate-400">Kiosk only — no email</div>}
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
                      <select
                        value={user.approval_group ?? ''}
                        onChange={(e) => handleApprovalGroupChange(user.id, e.target.value as ApprovalGroup | '')}
                        disabled={updatingApprovalGroupIds.has(user.id)}
                        className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-100"
                      >
                        <option value="">Unassigned</option>
                        {approvalGroupOptions.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-5 py-4">
                      {(user.time_categories ?? []).length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {user.time_categories!.map((tc) => (
                            <span key={tc.id} className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-slate-700">
                              {tc.name}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-xs text-slate-400">Not configured</span>
                      )}
                      <button
                        type="button"
                        onClick={() => openEditCategories(user)}
                        className="mt-1.5 text-xs font-medium text-cyan-700 hover:text-cyan-900"
                      >
                        Edit categories
                      </button>
                    </td>
                    <td className="px-5 py-4">
                      {user.is_pending ? (
                        <span className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">
                          {user.email ? 'Pending sign-in' : 'Kiosk only'}
                        </span>
                      ) : (
                        <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
                          Active
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-4">
                      <div className="space-y-1 text-sm">
                        <div>
                          {user.kiosk_pin_configured ? (
                            <span className="inline-flex rounded-full border border-cyan-200 bg-cyan-50 px-2.5 py-1 text-xs font-medium text-cyan-700">PIN ready</span>
                          ) : (
                            <span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-600">Not set</span>
                          )}
                        </div>
                        {user.kiosk_pin_last_rotated_at && <div className="text-xs text-slate-500">Rotated {formatDateTime(user.kiosk_pin_last_rotated_at)}</div>}
                        {user.kiosk_locked_until && <div className="text-xs text-red-600">Locked until {formatDateTime(user.kiosk_locked_until)}</div>}
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex flex-col items-end gap-2 text-sm font-medium">
                        <button
                          onClick={() => handleResetKioskPin(user)}
                          disabled={resettingPinIds.has(user.id)}
                          className="text-cyan-700 transition hover:text-cyan-900 disabled:opacity-50"
                        >
                          {resettingPinIds.has(user.id) ? 'Resetting…' : 'Reset PIN'}
                        </button>
                        {user.is_pending && user.email && (
                          <button
                            onClick={() => handleResendInvite(user)}
                            disabled={resendingIds.has(user.id)}
                            className="text-slate-700 transition hover:text-slate-900 disabled:opacity-50"
                          >
                            {resendingIds.has(user.id) ? 'Sending…' : 'Resend invite'}
                          </button>
                        )}
                        <button
                          onClick={() => handleDelete(user)}
                          disabled={deletingIds.has(user.id)}
                          className="text-red-600 transition hover:text-red-800 disabled:opacity-50"
                        >
                          {deletingIds.has(user.id) ? 'Removing…' : 'Remove'}
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

      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div ref={createModalRef} className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold text-slate-900">Add team member</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Create a staff record. Kiosk-only people need only a name and PIN — no email required.
                </p>
              </div>
              <button onClick={() => { setShowCreateModal(false); resetCreateForm() }} className="rounded-lg px-2 py-1 text-slate-500 hover:bg-slate-100">✕</button>
            </div>

            <form onSubmit={handleCreate} className="mt-6 space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-700">First Name *</label>
                  <input value={createFirstName} onChange={(e) => setCreateFirstName(e.target.value)} className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-100" required />
                </div>
                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-700">Last Name</label>
                  <input value={createLastName} onChange={(e) => setCreateLastName(e.target.value)} className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-100" />
                </div>
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700">
                  Email {sendInvitationEmail ? <span className="text-slate-400">*</span> : <span className="text-xs font-normal text-slate-400">(optional for kiosk-only)</span>}
                </label>
                <input
                  type="email"
                  value={createEmail}
                  onChange={(e) => setCreateEmail(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-100"
                  required={sendInvitationEmail}
                />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700">Role</label>
                <select value={createRole} onChange={(e) => setCreateRole(e.target.value as 'admin' | 'employee')} className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-100">
                  <option value="employee">Employee</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700">Approval Group</label>
                <select
                  value={createApprovalGroup}
                  onChange={(e) => setCreateApprovalGroup(e.target.value as ApprovalGroup | '')}
                  className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-100"
                >
                  <option value="">Unassigned</option>
                  {approvalGroupOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
                <p className="mt-2 text-xs text-slate-500">
                  This controls which pending approvals bucket they show up under.
                </p>
              </div>

              <label className="flex cursor-pointer gap-3 rounded-xl border border-slate-200 bg-slate-50/80 px-4 py-3">
                <input
                  type="checkbox"
                  checked={sendInvitationEmail}
                  onChange={(e) => setSendInvitationEmail(e.target.checked)}
                  className="mt-0.5 rounded border-slate-300 text-cyan-600 focus:ring-cyan-500"
                />
                <span>
                  <span className="block text-sm font-medium text-slate-800">Send invitation email</span>
                  <span className="mt-0.5 block text-xs text-slate-500">
                    Turn off for kiosk-only: add them and set a PIN without sending an email.
                  </span>
                </span>
              </label>

              {activeCategories.length > 0 && (
                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-700">Work categories</label>
                  <p className="mb-3 text-xs text-slate-500">
                    Select which types of work this person does. Only assigned categories will appear at the kiosk.
                  </p>
                  <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50/60 px-4 py-3">
                    {activeCategories.map((cat) => (
                      <label key={cat.id} className="flex cursor-pointer items-start gap-3">
                        <input
                          type="checkbox"
                          checked={createCategoryIds.has(cat.id)}
                          onChange={() => toggleCategoryId(createCategoryIds, setCreateCategoryIds, cat.id)}
                          className="mt-0.5 rounded border-slate-300 text-cyan-600 focus:ring-cyan-500"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium text-slate-800">{cat.name}</div>
                          {cat.description && <div className="mt-0.5 text-xs text-slate-500">{cat.description}</div>}
                        </div>
                      </label>
                    ))}
                  </div>
                  <p className="mt-2 text-xs text-slate-400">
                    If none are selected, no categories will appear at the kiosk for this person.
                  </p>
                </div>
              )}

              {createError && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{createError}</div>}
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => { setShowCreateModal(false); resetCreateForm() }} className="rounded-xl border border-slate-300 px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50">Cancel</button>
                <button type="submit" disabled={creating} className="rounded-xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50">
                  {creating ? 'Saving…' : sendInvitationEmail && createEmail.trim() ? 'Send invite' : 'Add team member'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {editingUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div ref={editModalRef} className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold text-slate-900">
                  Work categories for {editingUser.full_name}
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Select which types of work this person does. Only checked categories appear at the kiosk.
                </p>
              </div>
              <button onClick={() => setEditingUser(null)} className="rounded-lg px-2 py-1 text-slate-500 hover:bg-slate-100">✕</button>
            </div>

            <div className="mt-5 space-y-2 rounded-xl border border-slate-200 bg-slate-50/60 px-4 py-3">
              {activeCategories.map((cat) => (
                <label key={cat.id} className="flex cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    checked={editCategoryIds.has(cat.id)}
                    onChange={() => toggleCategoryId(editCategoryIds, setEditCategoryIds, cat.id)}
                    className="mt-0.5 rounded border-slate-300 text-cyan-600 focus:ring-cyan-500"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-slate-800">{cat.name}</div>
                    {cat.description && <div className="mt-0.5 text-xs text-slate-500">{cat.description}</div>}
                  </div>
                </label>
              ))}
              {activeCategories.length === 0 && (
                <div className="py-4 text-center text-sm text-slate-500">
                  No active categories. Create them in <a href="/admin/settings" className="font-medium text-cyan-700 hover:text-cyan-900">Settings</a> first.
                </div>
              )}
            </div>

            <p className="mt-3 text-xs text-slate-500">
              If no categories are selected, no categories will appear at the kiosk for this person.
            </p>

            <div className="mt-5 flex justify-end gap-3">
              <button type="button" onClick={() => setEditingUser(null)} className="rounded-xl border border-slate-300 px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50">
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveCategories}
                disabled={savingCategories}
                className="rounded-xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
              >
                {savingCategories ? 'Saving…' : 'Save categories'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
