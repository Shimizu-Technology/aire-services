import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../../lib/api'
import type { AdminUser, AdminTimeCategory, ApprovalGroup, ApprovalGroupOption } from '../../lib/api'
import { formatDateTime } from '../../lib/dateUtils'
import { FadeUp } from '../../components/ui/MotionComponents'

function isKioskLocked(user: AdminUser) {
  if (!user.kiosk_locked_until) return false

  const lockedUntil = new Date(user.kiosk_locked_until).getTime()
  return Number.isFinite(lockedUntil) && lockedUntil > Date.now()
}

export default function Users() {
  useEffect(() => {
    document.title = 'Users | AIRE Ops'
  }, [])

  const [users, setUsers] = useState<AdminUser[]>([])
  const [allCategories, setAllCategories] = useState<AdminTimeCategory[]>([])
  const [approvalGroupOptions, setApprovalGroupOptions] = useState<ApprovalGroupOption[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [roleFilter, setRoleFilter] = useState<'all' | AdminUser['role']>('all')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'pending' | 'inactive'>('all')
  const [departmentFilter, setDepartmentFilter] = useState<'all' | 'unassigned' | ApprovalGroup>('all')
  const [kioskFilter, setKioskFilter] = useState<'all' | 'pin_ready' | 'no_pin' | 'locked'>('all')
  const [publicTeamFilter, setPublicTeamFilter] = useState<'all' | 'visible' | 'hidden'>('all')

  const [showCreateModal, setShowCreateModal] = useState(false)
  const [createFirstName, setCreateFirstName] = useState('')
  const [createLastName, setCreateLastName] = useState('')
  const [createEmail, setCreateEmail] = useState('')
  const [createRole, setCreateRole] = useState<'admin' | 'employee'>('employee')
  const [createStaffTitle, setCreateStaffTitle] = useState('')
  const [createApprovalGroup, setCreateApprovalGroup] = useState<ApprovalGroup | ''>('')
  const [sendInvitationEmail, setSendInvitationEmail] = useState(true)
  const [createCategoryIds, setCreateCategoryIds] = useState<Set<number>>(new Set())
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')

  const [editingUser, setEditingUser] = useState<AdminUser | null>(null)
  const [editFirstName, setEditFirstName] = useState('')
  const [editLastName, setEditLastName] = useState('')
  const [editEmail, setEditEmail] = useState('')
  const [editRole, setEditRole] = useState<'admin' | 'employee'>('employee')
  const [editStaffTitle, setEditStaffTitle] = useState('')
  const [editApprovalGroup, setEditApprovalGroup] = useState<ApprovalGroup | ''>('')
  const [editPublicTeamEnabled, setEditPublicTeamEnabled] = useState(false)
  const [editPublicTeamName, setEditPublicTeamName] = useState('')
  const [editPublicTeamTitle, setEditPublicTeamTitle] = useState('')
  const [editPublicTeamSortOrder, setEditPublicTeamSortOrder] = useState('0')
  const [editCategoryIds, setEditCategoryIds] = useState<Set<number>>(new Set())
  const [savingEdit, setSavingEdit] = useState(false)
  const [editError, setEditError] = useState('')

  const [pinModalUser, setPinModalUser] = useState<AdminUser | null>(null)
  const [customPin, setCustomPin] = useState('')
  const [pinResult, setPinResult] = useState('')
  const [pinError, setPinError] = useState('')
  const [savingPin, setSavingPin] = useState(false)

  const [resendingIds, setResendingIds] = useState<Set<number>>(new Set())
  const [deletingIds, setDeletingIds] = useState<Set<number>>(new Set())
  const createModalRef = useRef<HTMLDivElement>(null)
  const editModalRef = useRef<HTMLDivElement>(null)
  const pinModalRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (showCreateModal && createModalRef.current) {
      const first = createModalRef.current.querySelector<HTMLElement>('input, select, textarea')
      if (first) setTimeout(() => first.focus(), 0)
    }
  }, [showCreateModal])

  useEffect(() => {
    if (editingUser && editModalRef.current) {
      const first = editModalRef.current.querySelector<HTMLElement>('input, select, textarea')
      if (first) setTimeout(() => first.focus(), 0)
    }
  }, [editingUser])

  useEffect(() => {
    if (pinModalUser && pinModalRef.current) {
      const first = pinModalRef.current.querySelector<HTMLElement>('input, button')
      if (first) setTimeout(() => first.focus(), 0)
    }
  }, [pinModalUser])

  const applyFetchedData = useCallback((
    usersRes: Awaited<ReturnType<typeof api.getAdminUsers>>,
    catsRes: Awaited<ReturnType<typeof api.getAdminTimeCategories>>,
    settingsRes: Awaited<ReturnType<typeof api.getAdminAppSettings>>,
  ) => {
    if (usersRes.data) setUsers(usersRes.data.users.filter((u) => u.role === 'admin' || u.role === 'employee'))
    else if (usersRes.error) console.error('Failed to refresh users:', usersRes.error)
    if (catsRes.data) setAllCategories(catsRes.data.time_categories)
    else if (catsRes.error) console.error('Failed to refresh categories:', catsRes.error)
    if (settingsRes.data) setApprovalGroupOptions(settingsRes.data.approval_groups)
    else if (settingsRes.error) console.error('Failed to refresh approval groups:', settingsRes.error)
  }, [])

  useEffect(() => {
    let cancelled = false
    async function initialLoad() {
      setLoading(true)
      try {
        const [usersRes, catsRes, settingsRes] = await Promise.all([
          api.getAdminUsers(),
          api.getAdminTimeCategories(),
          api.getAdminAppSettings(),
        ])
        if (!cancelled) applyFetchedData(usersRes, catsRes, settingsRes)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    initialLoad()
    return () => { cancelled = true }
  }, [applyFetchedData])

  const refreshData = useCallback(async () => {
    const [usersRes, catsRes, settingsRes] = await Promise.all([
      api.getAdminUsers(),
      api.getAdminTimeCategories(),
      api.getAdminAppSettings(),
    ])
    applyFetchedData(usersRes, catsRes, settingsRes)
  }, [applyFetchedData])

  const activeCategories = allCategories.filter((c) => c.is_active)
  const createUsesClerkProfile = createEmail.trim().length > 0
  const editingUserUsesClerkProfile = editingUser?.uses_clerk_profile ?? false
  const canEditPendingInviteEmail = Boolean(editingUserUsesClerkProfile && editingUser?.is_pending)
  const canEditActiveClerkProfile = Boolean(editingUserUsesClerkProfile && editingUser && !editingUser.is_pending)
  const editingUserIsKioskOnly = Boolean(editingUser && !editingUserUsesClerkProfile)
  const canConvertPendingKioskUser = Boolean(editingUserIsKioskOnly && editingUser?.is_pending)
  const canEditEmail = Boolean(canEditPendingInviteEmail || canConvertPendingKioskUser)
  const routedUsersCount = users.filter((user) => !!user.approval_group).length
  const publicTeamUsersCount = users.filter((user) => user.is_active && user.public_team_enabled).length
  const normalizedSearchTerm = searchTerm.trim().toLowerCase()
  const hasActiveFilters = Boolean(
    normalizedSearchTerm ||
    roleFilter !== 'all' ||
    statusFilter !== 'all' ||
    departmentFilter !== 'all' ||
    kioskFilter !== 'all' ||
    publicTeamFilter !== 'all',
  )
  const filteredUsers = useMemo(() => {
    return users.filter((user) => {
      if (roleFilter !== 'all' && user.role !== roleFilter) return false

      if (statusFilter === 'active' && (!user.is_active || user.is_pending)) return false
      if (statusFilter === 'pending' && (!user.is_active || !user.is_pending)) return false
      if (statusFilter === 'inactive' && user.is_active) return false

      if (departmentFilter === 'unassigned' && user.approval_group) return false
      if (departmentFilter !== 'all' && departmentFilter !== 'unassigned' && user.approval_group !== departmentFilter) return false

      if (kioskFilter === 'pin_ready' && !user.kiosk_pin_configured) return false
      if (kioskFilter === 'no_pin' && user.kiosk_pin_configured) return false
      if (kioskFilter === 'locked' && !isKioskLocked(user)) return false

      if (publicTeamFilter === 'visible' && !(user.is_active && user.public_team_enabled)) return false
      if (publicTeamFilter === 'hidden' && user.is_active && user.public_team_enabled) return false

      if (!normalizedSearchTerm) return true
      const statusTokens = user.is_pending ? ['pending'] : [user.is_active ? 'active' : 'inactive']

      if (['active', 'inactive', 'pending'].includes(normalizedSearchTerm)) {
        return statusTokens.includes(normalizedSearchTerm)
      }

      const searchableText = [
        user.full_name,
        user.display_name,
        user.first_name,
        user.last_name,
        user.email,
        user.staff_title,
        user.public_team_name,
        user.public_team_title,
        user.approval_group_label,
        user.role,
        user.is_pending ? 'pending sign-in kiosk only invited' : statusTokens[0],
        user.public_team_enabled ? 'public team visible' : 'public team hidden',
        user.kiosk_pin_configured ? 'pin ready kiosk' : 'no pin kiosk not set',
        ...(user.time_categories ?? []).map((category) => category.name),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()

      return searchableText.includes(normalizedSearchTerm)
    })
  }, [departmentFilter, kioskFilter, normalizedSearchTerm, publicTeamFilter, roleFilter, statusFilter, users])

  const resetFilters = () => {
    setSearchTerm('')
    setRoleFilter('all')
    setStatusFilter('all')
    setDepartmentFilter('all')
    setKioskFilter('all')
    setPublicTeamFilter('all')
  }

  const patchLocalUser = useCallback((userId: number, updater: (user: AdminUser) => AdminUser) => {
    setUsers((prev) => prev.map((user) => (user.id === userId ? updater(user) : user)))
  }, [])

  const loadEditState = useCallback((user: AdminUser) => {
    setEditingUser(user)
    setEditFirstName(user.first_name ?? '')
    setEditLastName(user.last_name ?? '')
    setEditEmail(user.email ?? '')
    setEditRole(user.role)
    setEditStaffTitle(user.staff_title ?? '')
    setEditApprovalGroup(user.approval_group ?? '')
    setEditPublicTeamEnabled(user.public_team_enabled)
    setEditPublicTeamName(user.public_team_name ?? '')
    setEditPublicTeamTitle(user.public_team_title ?? '')
    setEditPublicTeamSortOrder(String(user.public_team_sort_order ?? 0))
    setEditCategoryIds(new Set(user.time_category_ids ?? []))
    setEditError('')
  }, [])

  const resetCreateForm = () => {
    setCreateFirstName('')
    setCreateLastName('')
    setCreateEmail('')
    setCreateRole('employee')
    setCreateStaffTitle('')
    setCreateApprovalGroup('')
    setSendInvitationEmail(true)
    setCreateCategoryIds(new Set())
    setCreateError('')
  }

  const closeEditModal = () => {
    setEditingUser(null)
    setEditFirstName('')
    setEditLastName('')
    setEditEmail('')
    setEditRole('employee')
    setEditStaffTitle('')
    setEditApprovalGroup('')
    setEditPublicTeamEnabled(false)
    setEditPublicTeamName('')
    setEditPublicTeamTitle('')
    setEditPublicTeamSortOrder('0')
    setEditCategoryIds(new Set())
    setSavingEdit(false)
    setEditError('')
  }

  const closePinModal = () => {
    setPinModalUser(null)
    setCustomPin('')
    setPinResult('')
    setPinError('')
    setSavingPin(false)
  }

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    setCreateError('')
    setCreating(true)

    try {
      const response = await api.inviteUser({
        email: createEmail.trim() || undefined,
        ...(createUsesClerkProfile ? {} : {
          first_name: createFirstName.trim(),
          last_name: createLastName.trim() || undefined,
        }),
        staff_title: createStaffTitle.trim() || undefined,
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

  const openEditUser = (user: AdminUser) => loadEditState(user)

  const handleSaveUser = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!editingUser) return
    setEditError('')
    setSavingEdit(true)
    const targetUserId = editingUser.id
    const nextFirstName = editFirstName.trim()
    const nextLastName = editLastName.trim()
    const nextEmail = editEmail.trim().toLowerCase()
    const nextStaffTitle = editStaffTitle.trim()
    const nextPublicTeamName = editPublicTeamName.trim()
    const nextPublicTeamTitle = editPublicTeamTitle.trim()
    const hasPublicTeamSortOrder = editPublicTeamSortOrder.trim().length > 0
    const nextPublicTeamSortOrder = hasPublicTeamSortOrder ? Number.parseInt(editPublicTeamSortOrder, 10) : null
    const nextCategoryIds = Array.from(editCategoryIds)

    if ((editingUserIsKioskOnly || canEditActiveClerkProfile) && !nextFirstName) {
      setEditError('First name is required.')
      setSavingEdit(false)
      return
    }

    if (canEditPendingInviteEmail && !nextEmail) {
      setEditError('Email is required for Clerk-managed users.')
      setSavingEdit(false)
      return
    }

    if (editPublicTeamEnabled) {
      if (!nextPublicTeamTitle && !nextStaffTitle) {
        setEditError('Add a staff title or public title before showing someone on the Team page.')
        setSavingEdit(false)
        return
      }

      const hasProfileName = nextFirstName.length > 0 || nextLastName.length > 0 || nextPublicTeamName.length > 0
      if (!hasProfileName) {
        setEditError('Add a public display name before showing someone on the Team page.')
        setSavingEdit(false)
        return
      }

      if (nextPublicTeamSortOrder === null || Number.isNaN(nextPublicTeamSortOrder)) {
        setEditError('Public team sort order must be a whole number.')
        setSavingEdit(false)
        return
      }
    }

    try {
      const payload: Parameters<typeof api.updateUser>[1] = {
        role: editRole,
        staff_title: nextStaffTitle || null,
        approval_group: editApprovalGroup || null,
        public_team_enabled: editPublicTeamEnabled,
        public_team_name: nextPublicTeamName || null,
        public_team_title: nextPublicTeamTitle || null,
        time_category_ids: nextCategoryIds,
      }

      if (nextPublicTeamSortOrder !== null) {
        payload.public_team_sort_order = nextPublicTeamSortOrder
      }

      if (editingUserUsesClerkProfile) {
        if (canEditPendingInviteEmail) {
          payload.email = nextEmail
        }
        if (canEditActiveClerkProfile) {
          payload.first_name = nextFirstName
          payload.last_name = nextLastName || ''
        }
      } else {
        payload.first_name = nextFirstName
        payload.last_name = nextLastName || ''
        if (nextEmail) {
          payload.email = nextEmail
        }
      }

      const res = await api.updateUser(targetUserId, payload)
      if (res.error) {
        setEditError(res.error)
      } else {
        if (res.data?.user) {
          patchLocalUser(targetUserId, () => res.data!.user)
        }
        closeEditModal()
      }
    } finally {
      setSavingEdit(false)
    }
  }

  const handleSetUserActive = async (user: AdminUser, isActive: boolean) => {
    setSavingEdit(true)
    setEditError('')
    try {
      const response = await api.updateUser(user.id, { is_active: isActive })
      if (response.error) {
        setEditError(response.error)
      } else if (response.data?.user) {
        patchLocalUser(user.id, () => response.data!.user)
        loadEditState(response.data.user)
      }
    } finally {
      setSavingEdit(false)
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

  const openPinModal = (user: AdminUser) => {
    setPinModalUser(user)
    setCustomPin('')
    setPinResult('')
    setPinError('')
  }

  const handleResetKioskPin = async (user: AdminUser, pin?: string) => {
    setSavingPin(true)
    setPinError('')
    try {
      const response = await api.resetKioskPin(user.id, pin || undefined)
      if (response.error || !response.data) {
        setPinError(response.error || 'Failed to reset kiosk PIN')
      } else {
        setPinResult(response.data.kiosk_pin)
        refreshData()
      }
    } catch {
      setPinError('Failed to reset kiosk PIN')
    } finally {
      setSavingPin(false)
    }
  }

  function toggleCategoryId(set: Set<number>, setter: (s: Set<number>) => void, id: number) {
    const next = new Set(set)
    if (next.has(id)) { next.delete(id) } else { next.add(id) }
    setter(next)
  }

  function renderStatusBadge(user: AdminUser) {
    if (!user.is_active) {
      return (
        <span className="inline-flex rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-medium text-rose-700">
          Inactive
        </span>
      )
    }

    if (user.is_pending) {
      return (
        <span className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">
          {user.email ? 'Pending sign-in' : 'Kiosk only'}
        </span>
      )
    }

    return (
      <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
        Active
      </span>
    )
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

      <div className="grid gap-4 md:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="text-sm text-slate-500">Total Team Members</div>
          <div className="mt-2 text-3xl font-bold text-slate-900">{users.length}</div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="text-sm text-slate-500">Admins</div>
          <div className="mt-2 text-3xl font-bold text-cyan-700">{users.filter((u) => u.role === 'admin').length}</div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="text-sm text-slate-500">Assigned Departments</div>
          <div className="mt-2 text-3xl font-bold text-slate-900">{routedUsersCount}</div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="text-sm text-slate-500">Shown on Team Page</div>
          <div className="mt-2 text-3xl font-bold text-slate-900">{publicTeamUsersCount}</div>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">AIRE Team</h2>
              <p className="mt-1 text-sm text-slate-500">Roles, departments, work categories, and kiosk access.</p>
            </div>
            {!loading && (
              <div className="text-sm text-slate-500">
                Showing <span className="font-semibold text-slate-800">{filteredUsers.length}</span> of {users.length}
              </div>
            )}
          </div>
        </div>

        {loading ? (
          <div className="px-5 py-10 text-center text-sm text-slate-500">Loading team members...</div>
        ) : users.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-slate-500">No team members yet.</div>
        ) : (
          <>
            <div className="border-b border-slate-200 bg-slate-50/70 px-5 py-4">
              <div className="grid gap-3 lg:grid-cols-[minmax(16rem,1fr)_repeat(5,minmax(8rem,auto))]">
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Search</span>
                  <input
                    value={searchTerm}
                    onChange={(event) => setSearchTerm(event.target.value)}
                    placeholder="Name, email, title, category..."
                    className="h-10 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-100"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Role</span>
                  <select
                    value={roleFilter}
                    onChange={(event) => setRoleFilter(event.target.value as typeof roleFilter)}
                    className="h-10 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-100"
                  >
                    <option value="all">All roles</option>
                    <option value="admin">Admins</option>
                    <option value="employee">Employees</option>
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Status</span>
                  <select
                    value={statusFilter}
                    onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}
                    className="h-10 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-100"
                  >
                    <option value="all">All statuses</option>
                    <option value="active">Active</option>
                    <option value="pending">Pending</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Department</span>
                  <select
                    value={departmentFilter}
                    onChange={(event) => setDepartmentFilter(event.target.value as typeof departmentFilter)}
                    className="h-10 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-100"
                  >
                    <option value="all">All departments</option>
                    <option value="unassigned">Unassigned</option>
                    {approvalGroupOptions.map((option) => (
                      <option key={option.key} value={option.key}>{option.label}</option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Kiosk</span>
                  <select
                    value={kioskFilter}
                    onChange={(event) => setKioskFilter(event.target.value as typeof kioskFilter)}
                    className="h-10 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-100"
                  >
                    <option value="all">All kiosk states</option>
                    <option value="pin_ready">PIN ready</option>
                    <option value="no_pin">No PIN</option>
                    <option value="locked">Locked</option>
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Public</span>
                  <select
                    value={publicTeamFilter}
                    onChange={(event) => setPublicTeamFilter(event.target.value as typeof publicTeamFilter)}
                    className="h-10 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-100"
                  >
                    <option value="all">All public states</option>
                    <option value="visible">Visible</option>
                    <option value="hidden">Hidden</option>
                  </select>
                </label>
              </div>
              {hasActiveFilters && (
                <div className="mt-3 flex items-center justify-between gap-3 text-sm text-slate-500">
                  <span>Filters are narrowing the team list.</span>
                  <button
                    type="button"
                    onClick={resetFilters}
                    className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
                  >
                    Clear filters
                  </button>
                </div>
              )}
            </div>

            {filteredUsers.length === 0 ? (
              <div className="px-5 py-10 text-center text-sm text-slate-500">No team members match those filters.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1200px]">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Team Member</th>
                      <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Role</th>
                      <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Public Team</th>
                      <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Department</th>
                      <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Work Categories</th>
                      <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Status</th>
                      <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Kiosk</th>
                      <th className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {filteredUsers.map((user) => (
                  <tr key={user.id} className="hover:bg-slate-50/80">
                    <td className="px-5 py-4">
                      <div className="font-medium text-slate-900">{user.full_name || user.display_name}</div>
                      {user.staff_title && <div className="mt-1 text-sm text-slate-500">{user.staff_title}</div>}
                      {user.email && <div className="mt-1 text-sm text-slate-500">{user.email}</div>}
                      {!user.email && <div className="mt-1 text-xs italic text-slate-400">Kiosk only — no email</div>}
                    </td>
                    <td className="px-5 py-4">
                      <span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700">
                        {user.role === 'admin' ? 'Admin' : 'Employee'}
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      {user.public_team_enabled ? (
                        <div className="space-y-1">
                          <span className="inline-flex rounded-full border border-cyan-200 bg-cyan-50 px-2.5 py-1 text-xs font-medium text-cyan-700">
                            Visible
                          </span>
                          {(user.public_team_title || user.staff_title) && (
                            <div className="text-xs text-slate-500">{user.public_team_title || user.staff_title}</div>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-slate-400">Hidden</span>
                      )}
                    </td>
                    <td className="px-5 py-4">
                      <span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700">
                        {user.approval_group_label ?? 'Unassigned'}
                      </span>
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
                    </td>
                    <td className="px-5 py-4">
                      {renderStatusBadge(user)}
                    </td>
                    <td className="px-5 py-4">
                      <div className="space-y-1 text-sm">
                        <div className="flex">
                          {user.kiosk_pin_configured ? (
                            <span className="inline-flex min-w-[6.5rem] justify-center rounded-full border border-cyan-200 bg-cyan-50 px-2.5 py-1 text-center text-xs font-medium leading-tight text-cyan-700">PIN ready</span>
                          ) : (
                            <span className="inline-flex min-w-[6.5rem] justify-center rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-center text-xs font-medium leading-tight text-slate-600">Not set</span>
                          )}
                        </div>
                        {user.kiosk_pin_last_rotated_at && <div className="text-xs text-slate-500">Rotated {formatDateTime(user.kiosk_pin_last_rotated_at)}</div>}
                        {isKioskLocked(user) && <div className="text-xs text-red-600">Locked until {formatDateTime(user.kiosk_locked_until!)}</div>}
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex flex-col items-end gap-2 text-sm font-medium">
                        <button
                          type="button"
                          onClick={() => openEditUser(user)}
                          className="text-slate-700 transition hover:text-slate-900"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => openPinModal(user)}
                          className="text-cyan-700 transition hover:text-cyan-900"
                        >
                          Reset PIN
                        </button>
                        {user.is_active && user.is_pending && user.email && (
                          <button
                            type="button"
                            onClick={() => handleResendInvite(user)}
                            disabled={resendingIds.has(user.id)}
                            className="text-slate-700 transition hover:text-slate-900 disabled:opacity-50"
                          >
                            {resendingIds.has(user.id) ? 'Sending…' : 'Resend invite'}
                          </button>
                        )}
                        <button
                          type="button"
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
          </>
        )}
      </div>

      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div ref={createModalRef} className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold text-slate-900">Add team member</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Create a staff record. Email-based accounts get their name from Clerk after sign-in, while kiosk-only staff need a local name and PIN.
                </p>
              </div>
              <button onClick={() => { setShowCreateModal(false); resetCreateForm() }} className="rounded-lg px-2 py-1 text-slate-500 hover:bg-slate-100">✕</button>
            </div>

            <form onSubmit={handleCreate} className="mt-6 space-y-4">
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
              {createUsesClerkProfile ? (
                <div className="rounded-xl border border-cyan-200 bg-cyan-50 px-4 py-3 text-sm text-cyan-900">
                  First and last name will come from Clerk when this person signs in.
                </div>
              ) : (
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
              )}
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700">Role</label>
                <select value={createRole} onChange={(e) => setCreateRole(e.target.value as 'admin' | 'employee')} className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-100">
                  <option value="employee">Employee</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700">Department</label>
                <select
                  value={createApprovalGroup}
                  onChange={(e) => setCreateApprovalGroup(e.target.value as ApprovalGroup | '')}
                  className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-100"
                >
                  <option value="">Unassigned</option>
                  {approvalGroupOptions.map((option) => (
                    <option key={option.key} value={option.key}>{option.label}</option>
                  ))}
                </select>
                <p className="mt-2 text-xs text-slate-500">
                  This controls review routing and department filters across the admin tools.
                </p>
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700">Staff title</label>
                <input
                  value={createStaffTitle}
                  onChange={(e) => setCreateStaffTitle(e.target.value)}
                  placeholder="Certified Flight Instructor"
                  className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-100"
                />
                <p className="mt-2 text-xs text-slate-500">
                  Optional internal title. You can reuse this on the public Team page later.
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
                  Edit {editingUser.full_name || editingUser.display_name}
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Update profile details, department routing, public Team page visibility, and kiosk work categories in one place.
                </p>
              </div>
              <button type="button" onClick={closeEditModal} className="rounded-lg px-2 py-1 text-slate-500 hover:bg-slate-100">✕</button>
            </div>

            <form onSubmit={handleSaveUser} className="mt-6 space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-700">First Name *</label>
                  <input
                    value={editFirstName}
                    onChange={(event) => setEditFirstName(event.target.value)}
                    disabled={editingUserUsesClerkProfile && !canEditActiveClerkProfile}
                    className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-100 disabled:bg-slate-50 disabled:text-slate-400"
                    required
                  />
                </div>
                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-700">Last Name</label>
                  <input
                    value={editLastName}
                    onChange={(event) => setEditLastName(event.target.value)}
                    disabled={editingUserUsesClerkProfile && !canEditActiveClerkProfile}
                    className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-100 disabled:bg-slate-50 disabled:text-slate-400"
                  />
                </div>
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700">Email</label>
                <input
                  type="email"
                  value={editEmail}
                  onChange={(event) => setEditEmail(event.target.value)}
                  disabled={!canEditEmail}
                  className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-100 disabled:bg-slate-50 disabled:text-slate-400"
                />
                <p className="mt-2 text-xs text-slate-500">
                  {canEditPendingInviteEmail
                    ? 'This email controls the outstanding invite until they sign in.'
                    : canEditActiveClerkProfile
                      ? 'Active Clerk users keep their sign-in email managed in Clerk. Use this form for names, status, routing, and Team page details.'
                      : editingUserUsesClerkProfile
                        ? 'Clerk invite email stays editable until the account is activated.'
                      : canConvertPendingKioskUser
                        ? 'Add an email to convert this kiosk-only user into a pending invited user. Save, then use Resend invite from the table.'
                        : 'This kiosk-only user is no longer pending, so create a new invited user if they need email sign-in.'}
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-700">Role</label>
                  <select
                    value={editRole}
                    onChange={(event) => setEditRole(event.target.value as 'admin' | 'employee')}
                    className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-100"
                  >
                    <option value="employee">Employee</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-700">Department</label>
                  <select
                    value={editApprovalGroup}
                    onChange={(event) => setEditApprovalGroup(event.target.value as ApprovalGroup | '')}
                    className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-100"
                  >
                    <option value="">Unassigned</option>
                    {approvalGroupOptions.map((option) => (
                      <option key={option.key} value={option.key}>{option.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700">Staff title</label>
                <input
                  value={editStaffTitle}
                  onChange={(event) => setEditStaffTitle(event.target.value)}
                  placeholder="Certified Flight Instructor"
                  className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-100"
                />
                <p className="mt-2 text-xs text-slate-500">
                  Optional internal title. If the public title is blank, the Team page will use this automatically.
                </p>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4">
                <label className="flex cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    checked={editPublicTeamEnabled}
                    onChange={(event) => setEditPublicTeamEnabled(event.target.checked)}
                    className="mt-0.5 rounded border-slate-300 text-cyan-600 focus:ring-cyan-500"
                  />
                  <span>
                    <span className="block text-sm font-medium text-slate-800">Show on the public Team page</span>
                    <span className="mt-0.5 block text-xs text-slate-500">
                      Only active users with this enabled appear on <span className="font-medium">/team</span>.
                    </span>
                  </span>
                </label>

                {editPublicTeamEnabled && (
                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <div className="sm:col-span-2">
                      <label className="mb-2 block text-sm font-medium text-slate-700">Public display name</label>
                      <input
                        value={editPublicTeamName}
                        onChange={(event) => setEditPublicTeamName(event.target.value)}
                        placeholder="Leave blank to use the person’s profile name"
                        className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-100"
                      />
                      <p className="mt-2 text-xs text-slate-500">
                        Use this if their public-facing name should differ from their AIRE Ops profile.
                      </p>
                    </div>
                    <div>
                      <label className="mb-2 block text-sm font-medium text-slate-700">Public title override</label>
                      <input
                        value={editPublicTeamTitle}
                        onChange={(event) => setEditPublicTeamTitle(event.target.value)}
                        placeholder="Leave blank to use the staff title"
                        className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-100"
                      />
                      <p className="mt-2 text-xs text-slate-500">
                        Only set this when the public-facing title should differ from the internal staff title.
                      </p>
                    </div>
                    <div>
                      <label className="mb-2 block text-sm font-medium text-slate-700">Display order</label>
                      <input
                        type="number"
                        value={editPublicTeamSortOrder}
                        onChange={(event) => setEditPublicTeamSortOrder(event.target.value)}
                        className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-100"
                      />
                      <p className="mt-2 text-xs text-slate-500">Lower numbers appear first on the Team page.</p>
                    </div>
                  </div>
                )}
              </div>

              {activeCategories.length > 0 && (
                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-700">Work categories</label>
                  <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50/60 px-4 py-3">
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
                  </div>
                  <p className="mt-2 text-xs text-slate-500">
                    Assigned categories appear on the kiosk. If none are selected, the kiosk will fall back to General.
                  </p>
                </div>
              )}

              <div className={`rounded-xl border px-4 py-3 text-sm ${editingUser.is_active ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-rose-200 bg-rose-50 text-rose-900'}`}>
                <div className="font-medium">Account status</div>
                <div className="mt-1">
                  {editingUser.is_active
                    ? 'Active users can sign in and use the kiosk with their assigned PIN.'
                    : 'Inactive users cannot sign in or clock in at the kiosk until you reactivate them.'}
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                <div className="font-medium text-slate-800">Kiosk access</div>
                <div className="mt-1">
                  {editingUser.kiosk_pin_configured
                    ? `PIN ready${editingUser.kiosk_pin_last_rotated_at ? `, last rotated ${formatDateTime(editingUser.kiosk_pin_last_rotated_at)}` : ''}.`
                    : 'No kiosk PIN set yet. Staff can create their own PIN on first sign-in, or you can reset one from the table.'}
                </div>
              </div>

              {editError && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {editError}
                </div>
              )}

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => handleSetUserActive(editingUser, !editingUser.is_active)}
                  disabled={savingEdit}
                  className={`rounded-xl border px-4 py-3 text-sm font-medium transition disabled:opacity-50 ${editingUser.is_active ? 'border-rose-200 text-rose-700 hover:bg-rose-50' : 'border-emerald-200 text-emerald-700 hover:bg-emerald-50'}`}
                >
                  {editingUser.is_active ? 'Make inactive' : 'Reactivate user'}
                </button>
                <button type="button" onClick={closeEditModal} className="rounded-xl border border-slate-300 px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50">
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingEdit}
                  className="rounded-xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
                >
                  {savingEdit ? 'Saving…' : 'Save changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {pinModalUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div ref={pinModalRef} className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold text-slate-900">Reset kiosk PIN</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Set a custom 4 to 8 digit PIN for {pinModalUser.full_name}, or generate one automatically.
                </p>
              </div>
              <button type="button" onClick={closePinModal} className="rounded-lg px-2 py-1 text-slate-500 hover:bg-slate-100">✕</button>
            </div>

            <div className="mt-6 space-y-4">
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700">Custom PIN</label>
                <input
                  value={customPin}
                  onChange={(event) => setCustomPin(event.target.value.replace(/\D/g, '').slice(0, 8))}
                  inputMode="numeric"
                  placeholder="Leave blank to auto-generate"
                  className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-100"
                />
                <p className="mt-2 text-xs text-slate-500">If you leave this blank, AIRE Ops will generate a PIN for you.</p>
              </div>

              {pinResult && (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
                  <div className="text-xs font-semibold uppercase tracking-[0.12em] text-emerald-700">PIN ready</div>
                  <div className="mt-2 text-2xl font-semibold tracking-[0.2em] text-slate-900">{pinResult}</div>
                  <p className="mt-2 text-xs text-slate-600">Share this PIN privately with the team member.</p>
                </div>
              )}

              {pinError && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {pinError}
                </div>
              )}

              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={closePinModal} className="rounded-xl border border-slate-300 px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50">
                  Close
                </button>
                <button
                  type="button"
                  onClick={() => handleResetKioskPin(pinModalUser)}
                  disabled={savingPin}
                  className="rounded-xl border border-slate-300 px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  {savingPin ? 'Working…' : 'Generate PIN'}
                </button>
                <button
                  type="button"
                  onClick={() => handleResetKioskPin(pinModalUser, customPin.trim() || undefined)}
                  disabled={savingPin || customPin.trim().length === 0}
                  className="rounded-xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
                >
                  {savingPin ? 'Saving…' : 'Set PIN'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
