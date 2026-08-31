import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { api } from '../../lib/api'
import type { AdminUser, AdminTimeCategory, ApprovalGroup, ApprovalGroupOption } from '../../lib/api'
import { formatDateTime } from '../../lib/dateUtils'
import { initialsForName } from '../../lib/initials'
import { FadeUp } from '../../components/ui/MotionComponents'

const publicTeamPhotoAccept = 'image/jpeg,image/png,image/webp,image/avif,image/gif'
const maxPublicTeamPhotoSize = 15 * 1024 * 1024
const defaultPublicTeamPhotoPosition = 50

function photoPositionInputValue(value: number | null | undefined) {
  return String(typeof value === 'number' && Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : defaultPublicTeamPhotoPosition)
}

function parsedPhotoPosition(value: string) {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) return null
  return parsed
}

function publicTeamPhotoObjectPosition(x: number | string | null | undefined, y: number | string | null | undefined) {
  const parsedX = typeof x === 'number' ? x : parsedPhotoPosition(String(x ?? defaultPublicTeamPhotoPosition))
  const parsedY = typeof y === 'number' ? y : parsedPhotoPosition(String(y ?? defaultPublicTeamPhotoPosition))
  return `${parsedX ?? defaultPublicTeamPhotoPosition}% ${parsedY ?? defaultPublicTeamPhotoPosition}%`
}

function publicTeamPhotoStyle(x: number | string | null | undefined, y: number | string | null | undefined): CSSProperties {
  return { objectPosition: publicTeamPhotoObjectPosition(x, y) }
}

function isKioskLocked(user: AdminUser) {
  if (!user.kiosk_locked_until) return false

  const lockedUntil = new Date(user.kiosk_locked_until).getTime()
  return Number.isFinite(lockedUntil) && lockedUntil > Date.now()
}

function initialsForUser(user: AdminUser) {
  return initialsForName(user.public_team_name || user.full_name || user.display_name || user.email || 'AIRE Team')
}

function TeamMemberAvatar({ user, className = 'h-12 w-12' }: { user: AdminUser; className?: string }) {
  const src = user.public_team_photo_thumb_url || user.public_team_photo_url

  return (
    <div className={`relative shrink-0 overflow-hidden rounded-2xl border border-slate-200 bg-slate-100 ${className}`}>
      {src ? (
        <img
          src={src}
          alt=""
          className="h-full w-full object-cover"
          loading="lazy"
          style={publicTeamPhotoStyle(user.public_team_photo_position_x, user.public_team_photo_position_y)}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-[radial-gradient(circle_at_top,_rgba(34,211,238,0.22),_transparent_45%),linear-gradient(135deg,_#0f172a,_#1e3a5f)] text-sm font-semibold tracking-tight text-white">
          {initialsForUser(user)}
        </div>
      )}
    </div>
  )
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
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'pending' | 'inactive'>('active')
  const [departmentFilter, setDepartmentFilter] = useState<'all' | 'unassigned' | ApprovalGroup>('all')
  const [kioskFilter, setKioskFilter] = useState<'all' | 'pin_ready' | 'no_pin' | 'locked'>('all')
  const [publicTeamFilter, setPublicTeamFilter] = useState<'all' | 'visible' | 'hidden'>('all')

  const [showCreateModal, setShowCreateModal] = useState(false)
  const [createStep, setCreateStep] = useState<1 | 2>(1)
  const [createPersonalAccess, setCreatePersonalAccess] = useState(true)
  const [createTimeTracking, setCreateTimeTracking] = useState(true)
  const [createKioskPin, setCreateKioskPin] = useState('')
  const [createSuccess, setCreateSuccess] = useState<{ message: string; pin?: string | null } | null>(null)
  const [createFirstName, setCreateFirstName] = useState('')
  const [createLastName, setCreateLastName] = useState('')
  const [createEmail, setCreateEmail] = useState('')
  const [createRole, setCreateRole] = useState<'admin' | 'employee'>('employee')
  const [createIsIntern, setCreateIsIntern] = useState(false)
  const [createStaffTitle, setCreateStaffTitle] = useState('')
  const [createApprovalGroups, setCreateApprovalGroups] = useState<Set<ApprovalGroup>>(new Set())
  const [sendInvitationEmail, setSendInvitationEmail] = useState(true)
  const [createCategoryIds, setCreateCategoryIds] = useState<Set<number>>(new Set())
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')

  const [editingUser, setEditingUser] = useState<AdminUser | null>(null)
  const [editFirstName, setEditFirstName] = useState('')
  const [editLastName, setEditLastName] = useState('')
  const [editEmail, setEditEmail] = useState('')
  const [editRole, setEditRole] = useState<'admin' | 'employee'>('employee')
  const [editIsIntern, setEditIsIntern] = useState(false)
  const [editStaffTitle, setEditStaffTitle] = useState('')
  const [editApprovalGroups, setEditApprovalGroups] = useState<Set<ApprovalGroup>>(new Set())
  const [editPublicTeamEnabled, setEditPublicTeamEnabled] = useState(false)
  const [editPublicTeamName, setEditPublicTeamName] = useState('')
  const [editPublicTeamTitle, setEditPublicTeamTitle] = useState('')
  const [editPublicTeamSortOrder, setEditPublicTeamSortOrder] = useState('0')
  const [editPublicTeamPhotoPositionX, setEditPublicTeamPhotoPositionX] = useState(String(defaultPublicTeamPhotoPosition))
  const [editPublicTeamPhotoPositionY, setEditPublicTeamPhotoPositionY] = useState(String(defaultPublicTeamPhotoPosition))
  const [editPublicTeamPhotoFile, setEditPublicTeamPhotoFile] = useState<File | null>(null)
  const [editRemovePublicTeamPhoto, setEditRemovePublicTeamPhoto] = useState(false)
  const [editCategoryIds, setEditCategoryIds] = useState<Set<number>>(new Set())
  const [editPersonalAccess, setEditPersonalAccess] = useState(true)
  const [editTimeTracking, setEditTimeTracking] = useState(false)
  const [editKioskPin, setEditKioskPin] = useState('')
  const [editSendInvitation, setEditSendInvitation] = useState(false)
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

  const editPublicTeamPhotoPreviewUrl = useMemo(
    () => (editPublicTeamPhotoFile ? URL.createObjectURL(editPublicTeamPhotoFile) : null),
    [editPublicTeamPhotoFile],
  )
  const currentEditPublicTeamPhotoUrl = editPublicTeamPhotoPreviewUrl || (
    editRemovePublicTeamPhoto
      ? null
      : editingUser?.public_team_photo_card_url || editingUser?.public_team_photo_url || editingUser?.public_team_photo_thumb_url || null
  )
  const currentEditPublicTeamPhotoStyle = publicTeamPhotoStyle(editPublicTeamPhotoPositionX, editPublicTeamPhotoPositionY)

  useEffect(() => {
    return () => {
      if (editPublicTeamPhotoPreviewUrl) URL.revokeObjectURL(editPublicTeamPhotoPreviewUrl)
    }
  }, [editPublicTeamPhotoPreviewUrl])

  const activeCategories = allCategories.filter((c) => c.is_active)
  const createUsesClerkProfile = createPersonalAccess
  const canEditEmail = Boolean(editPersonalAccess && (editingUser?.is_pending || !editingUser?.has_clerk_account))
  const routedUsersCount = users.filter((user) => (user.approval_group_keys?.length ?? (user.approval_group ? 1 : 0)) > 0).length
  const publicTeamUsersCount = users.filter((user) => user.is_active && user.public_team_enabled).length
  const normalizedSearchTerm = searchTerm.trim().toLowerCase()
  const hasActiveFilters = Boolean(
    normalizedSearchTerm ||
    roleFilter !== 'all' ||
    statusFilter !== 'active' ||
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

      const userDepartmentKeys = user.approval_group_keys ?? (user.approval_group ? [user.approval_group] : [])
      if (departmentFilter === 'unassigned' && userDepartmentKeys.length > 0) return false
      if (departmentFilter !== 'all' && departmentFilter !== 'unassigned' && !userDepartmentKeys.includes(departmentFilter)) return false

      if (kioskFilter === 'pin_ready' && (!user.kiosk_enabled || !user.kiosk_pin_configured)) return false
      if (kioskFilter === 'no_pin' && (!user.time_tracking_enabled || !user.kiosk_enabled || user.kiosk_pin_configured)) return false
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
        ...(user.approval_group_labels ?? []),
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
    setStatusFilter('active')
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
    setEditIsIntern(Boolean(user.is_intern))
    setEditStaffTitle(user.staff_title ?? '')
    setEditApprovalGroups(new Set(user.approval_group_keys ?? (user.approval_group ? [user.approval_group] : [])))
    setEditPublicTeamEnabled(user.public_team_enabled)
    setEditPublicTeamName(user.public_team_name ?? '')
    setEditPublicTeamTitle(user.public_team_title ?? '')
    setEditPublicTeamSortOrder(String(user.public_team_sort_order ?? 0))
    setEditPublicTeamPhotoPositionX(photoPositionInputValue(user.public_team_photo_position_x))
    setEditPublicTeamPhotoPositionY(photoPositionInputValue(user.public_team_photo_position_y))
    setEditPublicTeamPhotoFile(null)
    setEditRemovePublicTeamPhoto(false)
    setEditCategoryIds(new Set(user.time_category_ids ?? []))
    setEditPersonalAccess(user.personal_access_enabled)
    setEditTimeTracking(user.time_tracking_enabled)
    setEditKioskPin('')
    setEditSendInvitation(false)
    setEditError('')
  }, [])

  const resetCreateForm = () => {
    setCreateStep(1)
    setCreatePersonalAccess(true)
    setCreateTimeTracking(true)
    setCreateKioskPin('')
    setCreateSuccess(null)
    setCreateFirstName('')
    setCreateLastName('')
    setCreateEmail('')
    setCreateRole('employee')
    setCreateIsIntern(false)
    setCreateStaffTitle('')
    setCreateApprovalGroups(new Set())
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
    setEditIsIntern(false)
    setEditStaffTitle('')
    setEditApprovalGroups(new Set())
    setEditPublicTeamEnabled(false)
    setEditPublicTeamName('')
    setEditPublicTeamTitle('')
    setEditPublicTeamSortOrder('0')
    setEditPublicTeamPhotoPositionX(String(defaultPublicTeamPhotoPosition))
    setEditPublicTeamPhotoPositionY(String(defaultPublicTeamPhotoPosition))
    setEditPublicTeamPhotoFile(null)
    setEditRemovePublicTeamPhoto(false)
    setEditCategoryIds(new Set())
    setEditPersonalAccess(true)
    setEditTimeTracking(false)
    setEditKioskPin('')
    setEditSendInvitation(false)
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

    if (createStep === 1) {
      if (createPersonalAccess && !createEmail.trim()) {
        setCreateError('Email is required for personal sign-in.')
        return
      }
      if (!createPersonalAccess && !createFirstName.trim()) {
        setCreateError('First name is required for a kiosk-only team member.')
        return
      }
      setCreateStep(2)
      return
    }

    if (createTimeTracking && createCategoryIds.size === 0) {
      setCreateError('Choose at least one work category for a person who tracks work hours.')
      return
    }

    setCreating(true)

    try {
      const response = await api.inviteUser({
        email: createPersonalAccess ? createEmail.trim() : undefined,
        ...(createUsesClerkProfile ? {} : {
          first_name: createFirstName.trim(),
          last_name: createLastName.trim() || undefined,
        }),
        staff_title: createStaffTitle.trim() || undefined,
        is_intern: createIsIntern,
        role: createRole,
        approval_groups: Array.from(createApprovalGroups),
        personal_access_enabled: createPersonalAccess,
        time_tracking_enabled: createTimeTracking,
        kiosk_enabled: createTimeTracking,
        kiosk_pin: !createPersonalAccess && createTimeTracking ? createKioskPin.trim() || undefined : undefined,
        send_invitation: createPersonalAccess && sendInvitationEmail,
        time_category_ids: createTimeTracking ? Array.from(createCategoryIds) : [],
      })
      if (response.error) {
        setCreateError(response.error)
      } else {
        const sent = response.data?.invitation_email_sent
        const inviteNote = createPersonalAccess
          ? sent === false
            ? 'The account was created, but the invitation email could not be sent. You can resend it from the user list.'
            : sendInvitationEmail
              ? 'Their invitation is on the way.'
              : 'You can send their invitation later from the user list.'
          : 'They can use the kiosk immediately with the PIN below.'
        setCreateSuccess({ message: inviteNote, pin: response.data?.kiosk_pin })
        void refreshData()
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
    const nextPublicTeamPhotoPositionX = parsedPhotoPosition(editPublicTeamPhotoPositionX)
    const nextPublicTeamPhotoPositionY = parsedPhotoPosition(editPublicTeamPhotoPositionY)
    const nextCategoryIds = Array.from(editCategoryIds)

    if (nextPublicTeamPhotoPositionX === null || nextPublicTeamPhotoPositionY === null) {
      setEditError('Photo focal point must stay between 0 and 100.')
      setSavingEdit(false)
      return
    }

    if (editPublicTeamPhotoFile && editPublicTeamPhotoFile.size > maxPublicTeamPhotoSize) {
      setEditError('Team photos must be smaller than 15MB.')
      setSavingEdit(false)
      return
    }

    if (!editPersonalAccess && !nextFirstName) {
      setEditError('First name is required.')
      setSavingEdit(false)
      return
    }

    if (editPersonalAccess && !nextEmail) {
      setEditError('Email is required for personal sign-in.')
      setSavingEdit(false)
      return
    }

    if (editTimeTracking && nextCategoryIds.length === 0) {
      setEditError('Choose at least one work category for a person who tracks work hours.')
      setSavingEdit(false)
      return
    }

    if (!editPersonalAccess && !editTimeTracking) {
      setEditError('Kiosk-only team members must track work hours.')
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
        is_intern: editIsIntern,
        staff_title: nextStaffTitle || null,
        approval_groups: Array.from(editApprovalGroups),
        public_team_enabled: editPublicTeamEnabled,
        public_team_name: nextPublicTeamName || null,
        public_team_title: nextPublicTeamTitle || null,
        public_team_photo_position_x: nextPublicTeamPhotoPositionX,
        public_team_photo_position_y: nextPublicTeamPhotoPositionY,
        personal_access_enabled: editPersonalAccess,
        time_tracking_enabled: editTimeTracking,
        kiosk_enabled: editTimeTracking,
        kiosk_pin: editKioskPin.trim() || undefined,
        send_invitation: editPersonalAccess && editSendInvitation,
        time_category_ids: editTimeTracking ? nextCategoryIds : [],
      }

      if (nextPublicTeamSortOrder !== null) {
        payload.public_team_sort_order = nextPublicTeamSortOrder
      }

      if (editPersonalAccess) {
        if (canEditEmail) payload.email = nextEmail
      } else {
        payload.first_name = nextFirstName
        payload.last_name = nextLastName || ''
      }

      const res = await api.updateUser(targetUserId, payload)
      if (res.error) {
        setEditError(res.error)
      } else {
        let savedUser = res.data?.user

        if (editPublicTeamPhotoFile) {
          const photoResponse = await api.updateUserPublicTeamPhoto(targetUserId, editPublicTeamPhotoFile)
          if (photoResponse.error) {
            if (savedUser) patchLocalUser(targetUserId, () => savedUser!)
            setEditError(`Profile saved, but the team photo could not be uploaded: ${photoResponse.error}`)
            return
          }
          savedUser = photoResponse.data?.user ?? savedUser
        } else if (editRemovePublicTeamPhoto) {
          const photoResponse = await api.removeUserPublicTeamPhoto(targetUserId)
          if (photoResponse.error) {
            if (savedUser) patchLocalUser(targetUserId, () => savedUser!)
            setEditError(`Profile saved, but the team photo could not be removed: ${photoResponse.error}`)
            return
          }
          savedUser = photoResponse.data?.user ?? savedUser
        }

        if (savedUser) {
          patchLocalUser(targetUserId, () => savedUser!)
        }
        const generatedPin = res.data?.kiosk_pin
        closeEditModal()
        if (generatedPin && savedUser) {
          setPinModalUser(savedUser)
          setPinResult(generatedPin)
        }
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

  function toggleApprovalGroup(set: Set<ApprovalGroup>, setter: (s: Set<ApprovalGroup>) => void, key: ApprovalGroup) {
    const next = new Set(set)
    if (next.has(key)) next.delete(key)
    else next.add(key)
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
                      <div className="flex items-start gap-3">
                        <TeamMemberAvatar user={user} />
                        <div className="min-w-0">
                          <div className="font-medium text-slate-900">{user.full_name || user.display_name}</div>
                          {user.staff_title && <div className="mt-1 text-sm text-slate-500">{user.staff_title}</div>}
                          {user.is_intern && (
                            <span className="mt-2 inline-flex rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                              Intern
                            </span>
                          )}
                          {user.personal_access_enabled && user.email && <div className="mt-1 truncate text-sm text-slate-500">{user.email}</div>}
                          {!user.personal_access_enabled && <div className="mt-1 text-xs italic text-slate-400">Kiosk only — personal sign-in off</div>}
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700">
                        {user.role === 'admin' ? 'Admin' : 'Employee'}
                      </span>
                      <div className="mt-1 text-xs text-slate-500">{user.personal_access_enabled ? 'Personal access' : 'Kiosk-only access'}</div>
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
                          <div className={`text-xs ${user.public_team_photo_thumb_url || user.public_team_photo_url ? 'text-emerald-600' : 'text-amber-600'}`}>
                            {user.public_team_photo_thumb_url || user.public_team_photo_url ? 'Portrait ready' : 'Text listing until photo'}
                          </div>
                        </div>
                      ) : (
                        <span className="text-xs text-slate-400">Hidden</span>
                      )}
                    </td>
                    <td className="px-5 py-4">
                      {(user.approval_group_labels?.length ?? 0) > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {user.approval_group_labels!.map((label) => (
                            <span key={label} className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700">
                              {label}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-xs text-slate-400">Unassigned</span>
                      )}
                    </td>
                    <td className="px-5 py-4">
                      {!user.time_tracking_enabled ? (
                        <span className="text-xs text-slate-400">Does not track hours</span>
                      ) : (user.time_categories ?? []).length > 0 ? (
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
                          {user.kiosk_enabled && user.kiosk_pin_configured ? (
                            <span className="inline-flex min-w-[6.5rem] justify-center rounded-full border border-cyan-200 bg-cyan-50 px-2.5 py-1 text-center text-xs font-medium leading-tight text-cyan-700">PIN ready</span>
                          ) : !user.kiosk_enabled ? (
                            <span className="inline-flex min-w-[6.5rem] justify-center rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-center text-xs font-medium leading-tight text-slate-500">Disabled</span>
                          ) : (
                            <span className="inline-flex min-w-[6.5rem] justify-center rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-center text-xs font-medium leading-tight text-slate-600">Not set</span>
                          )}
                        </div>
                        {user.kiosk_enabled && user.kiosk_pin_last_rotated_at && <div className="text-xs text-slate-500">Rotated {formatDateTime(user.kiosk_pin_last_rotated_at)}</div>}
                        {user.kiosk_enabled && isKioskLocked(user) && <div className="text-xs text-red-600">Locked until {formatDateTime(user.kiosk_locked_until!)}</div>}
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
                        {user.time_tracking_enabled && (
                          <button
                            type="button"
                            onClick={() => openPinModal(user)}
                            className="text-cyan-700 transition hover:text-cyan-900"
                          >
                            {user.kiosk_pin_configured ? 'Reset PIN' : 'Set kiosk PIN'}
                          </button>
                        )}
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
                        {!user.is_active && (
                          <button
                            type="button"
                            onClick={() => handleDelete(user)}
                            disabled={deletingIds.has(user.id)}
                            className="text-red-600 transition hover:text-red-800 disabled:opacity-50"
                            title="Permanent removal is only shown for inactive users. Make inactive is preferred for payroll history."
                          >
                            {deletingIds.has(user.id) ? 'Removing…' : 'Remove'}
                          </button>
                        )}
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-3 sm:p-6" role="presentation">
          <div ref={createModalRef} role="dialog" aria-modal="true" aria-labelledby="create-user-title" className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
            {createSuccess ? (
              <div className="p-6 sm:p-8">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                  <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="m5 12 4 4L19 6" /></svg>
                </div>
                <h2 id="create-user-title" className="mt-4 text-center text-2xl font-semibold text-slate-950">Team member added</h2>
                <p className="mx-auto mt-2 max-w-md text-center text-sm leading-6 text-slate-600">{createSuccess.message}</p>
                {createSuccess.pin && (
                  <div className="mx-auto mt-6 max-w-sm rounded-2xl border border-cyan-200 bg-cyan-50 p-5 text-center">
                    <div className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-800">Kiosk PIN</div>
                    <div className="mt-2 font-mono text-3xl font-semibold tracking-[0.28em] text-slate-950">{createSuccess.pin}</div>
                    <p className="mt-2 text-xs text-slate-600">Share this securely. It will not be shown again.</p>
                  </div>
                )}
                <button type="button" onClick={() => { setShowCreateModal(false); resetCreateForm() }} className="mt-7 w-full rounded-xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800">Done</button>
              </div>
            ) : (
              <form onSubmit={handleCreate} className="flex min-h-0 flex-1 flex-col">
                <div className="border-b border-slate-200 px-5 py-5 sm:px-7">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h2 id="create-user-title" className="text-xl font-semibold text-slate-950">Add team member</h2>
                      <p className="mt-1 text-sm text-slate-500">Set up access first, then choose their team and time-tracking details.</p>
                    </div>
                    <button type="button" aria-label="Close" onClick={() => { setShowCreateModal(false); resetCreateForm() }} className="rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900">
                      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18 18 6M6 6l12 12" /></svg>
                    </button>
                  </div>
                  <div className="mt-5 grid grid-cols-2 gap-2" aria-label={`Step ${createStep} of 2`}>
                    {[1, 2].map((step) => <div key={step} className={`h-1.5 rounded-full ${step <= createStep ? 'bg-cyan-600' : 'bg-slate-200'}`} />)}
                  </div>
                  <div className="mt-2 text-xs font-medium text-slate-500">Step {createStep} of 2 · {createStep === 1 ? 'Identity and access' : 'Work setup'}</div>
                </div>

                <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-6 sm:px-7">
                  {createStep === 1 ? (
                    <>
                      <div>
                        <label className="mb-2 block text-sm font-medium text-slate-700">Role</label>
                        <select value={createRole} onChange={(event) => {
                          const role = event.target.value as 'admin' | 'employee'
                          setCreateRole(role)
                          if (role === 'admin') setCreatePersonalAccess(true)
                        }} className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-100">
                          <option value="employee">Employee</option>
                          <option value="admin">Admin</option>
                        </select>
                        {createRole === 'admin' && <p className="mt-2 text-xs text-slate-500">Admins always need personal sign-in.</p>}
                      </div>

                      <fieldset>
                        <legend className="text-sm font-medium text-slate-700">How will this person access AIRE Ops?</legend>
                        <div className="mt-3 grid gap-3 sm:grid-cols-2">
                          <label className={`cursor-pointer rounded-2xl border p-4 transition ${createPersonalAccess ? 'border-cyan-500 bg-cyan-50/70 ring-2 ring-cyan-100' : 'border-slate-200 hover:border-slate-300'}`}>
                            <input type="radio" name="create-access" checked={createPersonalAccess} onChange={() => { setCreatePersonalAccess(true); setSendInvitationEmail(true) }} className="sr-only" />
                            <span className="block text-sm font-semibold text-slate-900">Personal account</span>
                            <span className="mt-1 block text-xs leading-5 text-slate-600">They sign in with email. Clerk supplies their name after activation.</span>
                          </label>
                          <label className={`rounded-2xl border p-4 transition ${createRole === 'admin' ? 'cursor-not-allowed bg-slate-50 opacity-50' : 'cursor-pointer'} ${!createPersonalAccess ? 'border-cyan-500 bg-cyan-50/70 ring-2 ring-cyan-100' : 'border-slate-200 hover:border-slate-300'}`}>
                            <input type="radio" name="create-access" checked={!createPersonalAccess} disabled={createRole === 'admin'} onChange={() => { setCreateRole('employee'); setCreatePersonalAccess(false); setSendInvitationEmail(false); setCreateTimeTracking(true) }} className="sr-only" />
                            <span className="block text-sm font-semibold text-slate-900">Kiosk only</span>
                            <span className="mt-1 block text-xs leading-5 text-slate-600">No email or account. AIRE stores their name and they clock in with a PIN.</span>
                          </label>
                        </div>
                      </fieldset>

                      {createPersonalAccess ? (
                        <>
                          <div>
                            <label htmlFor="create-email" className="mb-2 block text-sm font-medium text-slate-700">Email <span className="text-rose-600">*</span></label>
                            <input id="create-email" type="email" value={createEmail} onChange={(event) => setCreateEmail(event.target.value)} autoComplete="off" className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-100" required />
                          </div>
                          <div className="rounded-xl border border-cyan-200 bg-cyan-50 px-4 py-3 text-sm text-cyan-950">First and last name will come from Clerk when this person activates their account, so you do not need to enter them twice.</div>
                          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 p-4">
                            <input type="checkbox" checked={sendInvitationEmail} onChange={(event) => setSendInvitationEmail(event.target.checked)} className="mt-0.5 rounded border-slate-300 text-cyan-600 focus:ring-cyan-500" />
                            <span><span className="block text-sm font-medium text-slate-900">Send invitation now</span><span className="mt-1 block text-xs text-slate-500">You can also send or resend it from the user list.</span></span>
                          </label>
                        </>
                      ) : (
                        <div className="grid gap-4 sm:grid-cols-2">
                          <div><label htmlFor="create-first-name" className="mb-2 block text-sm font-medium text-slate-700">First name <span className="text-rose-600">*</span></label><input id="create-first-name" value={createFirstName} onChange={(event) => setCreateFirstName(event.target.value)} className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-100" required /></div>
                          <div><label htmlFor="create-last-name" className="mb-2 block text-sm font-medium text-slate-700">Last name</label><input id="create-last-name" value={createLastName} onChange={(event) => setCreateLastName(event.target.value)} className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-100" /></div>
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      <label className="flex cursor-pointer gap-3 rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3"><input type="checkbox" checked={createIsIntern} onChange={(event) => setCreateIsIntern(event.target.checked)} className="mt-0.5 rounded border-amber-300 text-amber-600 focus:ring-amber-500" /><span><span className="block text-sm font-medium text-slate-900">Mark as intern</span><span className="mt-1 block text-xs text-slate-600">Intern status is flagged in payroll reports.</span></span></label>
                      <div>
                        <label className="mb-2 block text-sm font-medium text-slate-700">Departments</label>
                        <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50/60 px-4 py-3">{approvalGroupOptions.map((option) => <label key={option.key} className="flex cursor-pointer items-center gap-3"><input type="checkbox" checked={createApprovalGroups.has(option.key)} onChange={() => toggleApprovalGroup(createApprovalGroups, setCreateApprovalGroups, option.key)} className="rounded border-slate-300 text-cyan-600 focus:ring-cyan-500" /><span className="text-sm font-medium text-slate-800">{option.label}</span></label>)}{approvalGroupOptions.length === 0 && <div className="text-sm text-slate-500">No departments configured.</div>}</div>
                        <p className="mt-2 text-xs text-slate-500">Departments control approval routing and admin filters; they do not determine clock-in categories.</p>
                      </div>
                      <div><label className="mb-2 block text-sm font-medium text-slate-700">Staff title</label><input value={createStaffTitle} onChange={(event) => setCreateStaffTitle(event.target.value)} placeholder="Certified Flight Instructor" className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-100" /></div>

                      <label className={`flex items-start gap-3 rounded-2xl border p-4 ${!createPersonalAccess ? 'cursor-not-allowed border-cyan-200 bg-cyan-50/70' : 'cursor-pointer border-slate-200'}`}>
                        <input type="checkbox" checked={createTimeTracking} disabled={!createPersonalAccess} onChange={(event) => setCreateTimeTracking(event.target.checked)} className="mt-0.5 rounded border-slate-300 text-cyan-600 focus:ring-cyan-500" />
                        <span><span className="block text-sm font-semibold text-slate-900">Tracks work hours</span><span className="mt-1 block text-xs leading-5 text-slate-600">Includes kiosk clock-in and requires at least one work category. Turn this off for salaried or non-clock-in staff.</span></span>
                      </label>

                      {createTimeTracking && (
                        <>
                          <div>
                            <div className="text-sm font-medium text-slate-700">Work categories <span className="text-rose-600">*</span></div>
                            <p className="mt-1 text-xs text-slate-500">At least one is required. If only one is assigned, it will be selected automatically at clock-in.</p>
                            <div className="mt-3 space-y-2 rounded-xl border border-slate-200 bg-slate-50/60 px-4 py-3">{activeCategories.map((cat) => <label key={cat.id} className="flex cursor-pointer items-start gap-3"><input type="checkbox" checked={createCategoryIds.has(cat.id)} onChange={() => toggleCategoryId(createCategoryIds, setCreateCategoryIds, cat.id)} className="mt-0.5 rounded border-slate-300 text-cyan-600 focus:ring-cyan-500" /><span><span className="block text-sm font-medium text-slate-800">{cat.name}</span>{cat.description && <span className="mt-0.5 block text-xs text-slate-500">{cat.description}</span>}</span></label>)}{activeCategories.length === 0 && <div className="text-sm text-rose-700">Create an active work category before adding a time-tracking user.</div>}</div>
                          </div>
                          <div className="rounded-xl border border-cyan-200 bg-cyan-50 px-4 py-3 text-sm leading-6 text-cyan-950">
                            <span className="font-medium">Kiosk access is included.</span>{' '}
                            {createPersonalAccess ? 'They will choose a PIN after their first sign-in.' : 'They will use a PIN to clock in and out.'}
                          </div>
                          {!createPersonalAccess && <div><label className="mb-2 block text-sm font-medium text-slate-700">Kiosk PIN <span className="text-xs font-normal text-slate-400">(optional)</span></label><input inputMode="numeric" pattern="[0-9]{4,8}" value={createKioskPin} onChange={(event) => setCreateKioskPin(event.target.value.replace(/\D/g, '').slice(0, 8))} placeholder="Generate automatically" className="w-full rounded-xl border border-slate-300 px-4 py-3 font-mono text-sm tracking-widest outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-100" /><p className="mt-2 text-xs text-slate-500">Leave blank to generate a secure six-digit PIN that is shown once after creation.</p></div>}
                        </>
                      )}
                    </>
                  )}

                  {createError && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{createError}</div>}
                </div>

                <div className="flex items-center justify-between gap-3 border-t border-slate-200 bg-white px-5 py-4 sm:px-7">
                  <button type="button" onClick={() => createStep === 2 ? (setCreateStep(1), setCreateError('')) : (setShowCreateModal(false), resetCreateForm())} className="rounded-xl border border-slate-300 px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50">{createStep === 2 ? 'Back' : 'Cancel'}</button>
                  <button type="submit" disabled={creating || (createStep === 2 && createTimeTracking && activeCategories.length === 0)} className="rounded-xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50">{createStep === 1 ? 'Continue' : creating ? 'Saving…' : createPersonalAccess && sendInvitationEmail ? 'Add and send invite' : 'Add team member'}</button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {editingUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div ref={editModalRef} role="dialog" aria-modal="true" aria-labelledby="edit-user-title" className="max-h-[90vh] w-full max-w-5xl overflow-y-auto rounded-2xl bg-white p-5 shadow-xl sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 id="edit-user-title" className="text-xl font-semibold text-slate-900">
                  Edit {editingUser.full_name || editingUser.display_name}
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Update profile details, department routing, public Team page visibility, and kiosk work categories in one place.
                </p>
              </div>
              <button type="button" aria-label="Close" onClick={closeEditModal} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100">
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18 18 6M6 6l12 12" /></svg>
              </button>
            </div>

            <form onSubmit={handleSaveUser} className="mt-6 space-y-4">
              <section className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4 sm:p-5" aria-labelledby="edit-access-title">
                <h3 id="edit-access-title" className="text-sm font-semibold text-slate-950">Access and identity</h3>
                <p className="mt-1 text-xs leading-5 text-slate-500">Change capabilities without replacing the employee record or losing time history.</p>

                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <label className={`flex items-start gap-3 rounded-xl border bg-white p-4 ${editRole === 'admin' ? 'cursor-not-allowed opacity-70' : 'cursor-pointer'}`}>
                    <input type="checkbox" checked={editPersonalAccess} disabled={editRole === 'admin'} onChange={(event) => {
                      setEditPersonalAccess(event.target.checked)
                      if (event.target.checked && editingUser && !editingUser.personal_access_enabled) setEditSendInvitation(!editingUser.has_clerk_account)
                      if (!event.target.checked) {
                        setEditTimeTracking(true)
                      }
                    }} className="mt-0.5 rounded border-slate-300 text-cyan-600 focus:ring-cyan-500" />
                    <span><span className="block text-sm font-medium text-slate-900">Personal sign-in</span><span className="mt-1 block text-xs leading-5 text-slate-500">Email account managed by Clerk.</span></span>
                  </label>
                  <label className={`flex items-start gap-3 rounded-xl border bg-white p-4 ${!editPersonalAccess ? 'cursor-not-allowed opacity-70' : 'cursor-pointer'}`}>
                    <input type="checkbox" checked={editTimeTracking} disabled={!editPersonalAccess} onChange={(event) => setEditTimeTracking(event.target.checked)} className="mt-0.5 rounded border-slate-300 text-cyan-600 focus:ring-cyan-500" />
                    <span><span className="block text-sm font-medium text-slate-900">Tracks work hours</span><span className="mt-1 block text-xs leading-5 text-slate-500">Includes kiosk access and requires at least one work category.</span></span>
                  </label>
                </div>

                {!editingUser.personal_access_enabled && editPersonalAccess && (
                  <div className="mt-3 rounded-xl border border-cyan-200 bg-cyan-50 p-3 text-xs leading-5 text-cyan-950">{editingUser.has_clerk_account ? 'Their existing Clerk account will be restored, and Clerk will become the name source again. Their employee record, kiosk setup, and history stay intact.' : 'Their local name and kiosk PIN stay active while the invitation is pending. Clerk becomes the name source only after their first successful sign-in.'}</div>
                )}
                {editingUser.personal_access_enabled && !editPersonalAccess && (
                  <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-950">Personal sign-in will stop immediately. Their current name will be kept locally, and their Clerk identifiers and prior history remain attached to this employee record.</div>
                )}
                {editingUser.time_tracking_enabled && !editTimeTracking && (
                  <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-950">Kiosk access will be removed. Existing time entries and category assignments remain in history, but this person will no longer be expected to clock in.</div>
                )}

                <div className="mt-4">
                  {editPersonalAccess ? (
                    <>
                      <label className="mb-2 block text-sm font-medium text-slate-700">Email <span className="text-rose-600">*</span></label>
                      <input type="email" value={editEmail} onChange={(event) => setEditEmail(event.target.value)} disabled={!canEditEmail} className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-100 disabled:bg-slate-100 disabled:text-slate-500" />
                      <p className="mt-2 text-xs text-slate-500">{editingUser.has_clerk_account ? 'This activated account’s email and name are managed by Clerk.' : 'This email will receive the invitation.'}</p>
                      {(editingUser.is_pending || (!editingUser.personal_access_enabled && !editingUser.has_clerk_account)) && <label className="mt-3 flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 bg-white p-3"><input type="checkbox" checked={editSendInvitation} onChange={(event) => setEditSendInvitation(event.target.checked)} className="mt-0.5 rounded border-slate-300 text-cyan-600 focus:ring-cyan-500" /><span className="text-sm text-slate-700">Send invitation when these changes are saved</span></label>}
                    </>
                  ) : (
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div><label className="mb-2 block text-sm font-medium text-slate-700">First name <span className="text-rose-600">*</span></label><input value={editFirstName} onChange={(event) => setEditFirstName(event.target.value)} className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-100" required /></div>
                      <div><label className="mb-2 block text-sm font-medium text-slate-700">Last name</label><input value={editLastName} onChange={(event) => setEditLastName(event.target.value)} className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-100" /></div>
                    </div>
                  )}
                </div>
              </section>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-700">Role</label>
                  <select
                    value={editRole}
                    onChange={(event) => {
                      const role = event.target.value as 'admin' | 'employee'
                      setEditRole(role)
                      if (role === 'admin') setEditPersonalAccess(true)
                    }}
                    className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-100"
                  >
                    <option value="employee">Employee</option>
                    <option value="admin">Admin</option>
                  </select>
                  <label className="mt-3 flex cursor-pointer items-start gap-3 rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3">
                    <input
                      type="checkbox"
                      checked={editIsIntern}
                      onChange={(event) => setEditIsIntern(event.target.checked)}
                      className="mt-0.5 rounded border-amber-300 text-amber-600 focus:ring-amber-500"
                    />
                    <span>
                      <span className="block text-sm font-medium text-slate-800">Intern</span>
                      <span className="mt-0.5 block text-xs text-slate-600">Shown on payroll reports.</span>
                    </span>
                  </label>
                </div>
                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-700">Departments</label>
                  <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50/60 px-4 py-3">
                    {approvalGroupOptions.map((option) => (
                      <label key={option.key} className="flex cursor-pointer items-center gap-3">
                        <input
                          type="checkbox"
                          checked={editApprovalGroups.has(option.key)}
                          onChange={() => toggleApprovalGroup(editApprovalGroups, setEditApprovalGroups, option.key)}
                          className="rounded border-slate-300 text-cyan-600 focus:ring-cyan-500"
                        />
                        <span className="text-sm font-medium text-slate-800">{option.label}</span>
                      </label>
                    ))}
                    {approvalGroupOptions.length === 0 && <div className="text-sm text-slate-500">No departments configured.</div>}
                  </div>
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
                    <div className="sm:col-span-2 rounded-[1.75rem] border border-cyan-100 bg-white p-4 shadow-sm sm:p-5">
                      <div className="grid gap-5 lg:grid-cols-[minmax(16rem,20rem)_1fr] lg:items-start">
                        <div className="self-start overflow-hidden rounded-2xl border border-slate-200 bg-slate-100">
                          <div className="aspect-[4/5]">
                            {currentEditPublicTeamPhotoUrl ? (
                              <img src={currentEditPublicTeamPhotoUrl} alt="" className="h-full w-full object-cover" style={currentEditPublicTeamPhotoStyle} />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center bg-[radial-gradient(circle_at_top,_rgba(34,211,238,0.22),_transparent_45%),linear-gradient(135deg,_#0f172a,_#1e3a5f)] text-xl font-semibold tracking-tight text-white">
                                {initialsForUser(editingUser)}
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="min-w-0">
                          <label className="mb-2 block text-sm font-medium text-slate-800">Public team photo</label>
                          <p className="text-xs leading-relaxed text-slate-500">
                            Upload a clean portrait for the public Team page. Use the focal-point controls below to keep faces centered when cards crop on phones.
                          </p>
                          <label className="mt-3 block rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-3 text-sm transition hover:border-cyan-300 hover:bg-cyan-50/60">
                            <span className="flex items-center gap-2 font-semibold text-slate-800">
                              <svg className="h-4 w-4 text-cyan-700" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 16V4m0 0 4.5 4.5M12 4 7.5 8.5M4 20h16" />
                              </svg>
                              Choose photo
                            </span>
                            <span className="mt-1 block text-xs text-slate-500">JPG, PNG, WebP, AVIF, or GIF up to 15MB.</span>
                            <input
                              type="file"
                              accept={publicTeamPhotoAccept}
                              onChange={(event) => {
                                const selected = event.target.files?.[0] || null
                                setEditPublicTeamPhotoFile(selected)
                                if (selected) setEditRemovePublicTeamPhoto(false)
                              }}
                              className="mt-3 block w-full text-xs text-slate-500"
                            />
                          </label>
                          <div className="mt-3 flex flex-wrap gap-2">
                            {editPublicTeamPhotoFile && (
                              <button
                                type="button"
                                onClick={() => setEditPublicTeamPhotoFile(null)}
                                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                              >
                                Clear selected photo
                              </button>
                            )}
                            {!editPublicTeamPhotoFile && !editRemovePublicTeamPhoto && (editingUser.public_team_photo_url || editingUser.public_team_photo_thumb_url) && (
                              <button
                                type="button"
                                onClick={() => setEditRemovePublicTeamPhoto(true)}
                                className="rounded-lg border border-rose-200 bg-white px-3 py-2 text-xs font-semibold text-rose-700 transition hover:bg-rose-50"
                              >
                                Remove current photo
                              </button>
                            )}
                            {editRemovePublicTeamPhoto && (
                              <button
                                type="button"
                                onClick={() => setEditRemovePublicTeamPhoto(false)}
                                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                              >
                                Undo removal
                              </button>
                            )}
                          </div>
                          {editRemovePublicTeamPhoto && <p className="mt-3 text-xs font-medium text-amber-700">The current photo will be removed when you save changes.</p>}

                          <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50/80 p-4 sm:p-5">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <div className="text-sm font-semibold text-slate-800">Photo focal point</div>
                                <p className="mt-1 text-xs leading-relaxed text-slate-500">
                                  Move the focal point toward the face or logo area. AIRE Ops will use this position anywhere the public Team photo has to crop.
                                </p>
                              </div>
                              <span className="shrink-0 rounded-full border border-cyan-200 bg-cyan-50 px-2.5 py-1 text-xs font-semibold text-cyan-800">
                                {editPublicTeamPhotoPositionX}% / {editPublicTeamPhotoPositionY}%
                              </span>
                            </div>

                            <div className="mt-4 space-y-4">
                              <label className="block">
                                <span className="flex justify-between text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                                  <span>Horizontal focus</span>
                                  <span>Left · Center · Right</span>
                                </span>
                                <input
                                  type="range"
                                  min="0"
                                  max="100"
                                  value={editPublicTeamPhotoPositionX}
                                  onChange={(event) => setEditPublicTeamPhotoPositionX(event.target.value)}
                                  className="mt-2 w-full accent-cyan-700"
                                />
                              </label>
                              <label className="block">
                                <span className="flex justify-between text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                                  <span>Vertical focus</span>
                                  <span>Top · Center · Bottom</span>
                                </span>
                                <input
                                  type="range"
                                  min="0"
                                  max="100"
                                  value={editPublicTeamPhotoPositionY}
                                  onChange={(event) => setEditPublicTeamPhotoPositionY(event.target.value)}
                                  className="mt-2 w-full accent-cyan-700"
                                />
                              </label>
                            </div>

                            <div className="mt-4 flex flex-wrap gap-2">
                              {[
                                { label: 'Center', x: 50, y: 50 },
                                { label: 'Face higher', x: 50, y: 30 },
                                { label: 'Face lower', x: 50, y: 65 },
                                { label: 'Focus left', x: 35, y: 50 },
                                { label: 'Focus right', x: 65, y: 50 },
                              ].map((preset) => (
                                <button
                                  key={preset.label}
                                  type="button"
                                  onClick={() => {
                                    setEditPublicTeamPhotoPositionX(String(preset.x))
                                    setEditPublicTeamPhotoPositionY(String(preset.y))
                                  }}
                                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:border-cyan-300 hover:bg-cyan-50"
                                >
                                  {preset.label}
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

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

              {editTimeTracking ? (
                <section className="rounded-2xl border border-slate-200 p-4 sm:p-5">
                  <h3 className="text-sm font-semibold text-slate-950">Time tracking setup</h3>
                  <p className="mt-1 text-xs text-slate-500">At least one active category is required. One category is selected automatically at clock-in; multiple categories require a choice.</p>
                  <div className="mt-4 space-y-2 rounded-xl border border-slate-200 bg-slate-50/60 px-4 py-3">
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
                    {activeCategories.length === 0 && <div className="text-sm text-rose-700">No active work categories are available.</div>}
                  </div>
                  <div className="mt-4 rounded-xl border border-cyan-200 bg-cyan-50 px-4 py-3 text-sm leading-6 text-cyan-950">
                    <span className="font-medium">Kiosk access is included.</span>{' '}
                    {editPersonalAccess ? 'This person can use both their account and the kiosk.' : 'This is how this person clocks in and out.'}
                  </div>
                  <div className="mt-4">
                    <label className="mb-2 block text-sm font-medium text-slate-700">{editingUser.kiosk_pin_configured ? 'Replace kiosk PIN' : 'Kiosk PIN'} <span className="text-xs font-normal text-slate-400">(optional)</span></label>
                    <input inputMode="numeric" pattern="[0-9]{4,8}" value={editKioskPin} onChange={(event) => setEditKioskPin(event.target.value.replace(/\D/g, '').slice(0, 8))} placeholder={editingUser.kiosk_pin_configured ? 'Keep current PIN' : editPersonalAccess ? 'Set one now instead' : 'Generate automatically'} className="w-full rounded-xl border border-slate-300 px-4 py-3 font-mono text-sm tracking-widest outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-100" />
                    <p className="mt-2 text-xs text-slate-500">{editingUser.kiosk_pin_configured ? `PIN ready${editingUser.kiosk_pin_last_rotated_at ? `, last rotated ${formatDateTime(editingUser.kiosk_pin_last_rotated_at)}` : ''}. Leave blank to keep it.` : editPersonalAccess ? 'Leave blank and they will choose their PIN after their next sign-in.' : 'Leave blank to generate a secure six-digit PIN that is shown once after saving.'}</p>
                  </div>
                </section>
              ) : (
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600"><span className="font-medium text-slate-900">No time tracking.</span> This person does not need work categories or a kiosk PIN and will not be treated as missing hours.</div>
              )}

              <div className={`rounded-xl border px-4 py-3 text-sm ${editingUser.is_active ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-rose-200 bg-rose-50 text-rose-900'}`}>
                <div className="font-medium">Account status</div>
                <div className="mt-1">
                  {editingUser.is_active
                    ? 'This employee record is active. The access capabilities above determine how they can use AIRE Ops.'
                    : 'Inactive users cannot sign in or clock in until you reactivate them.'}
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
          <div ref={pinModalRef} role="dialog" aria-modal="true" aria-labelledby="pin-modal-title" className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 id="pin-modal-title" className="text-xl font-semibold text-slate-900">Reset kiosk PIN</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Set a custom 4 to 8 digit PIN for {pinModalUser.full_name}, or generate one automatically.
                </p>
              </div>
              <button type="button" aria-label="Close" onClick={closePinModal} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18 18 6M6 6l12 12" /></svg></button>
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
