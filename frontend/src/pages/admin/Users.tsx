import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { UserPlus } from 'lucide-react'
import { useAuthContext } from '../../contexts/AuthContext'
import { useDialogFocus } from '../../lib/useDialogFocus'
import { employeeWorkspaceHref, safeAdminReturn } from '../../lib/employeeWorkspace'
import { api } from '../../lib/api'
import { invitationOutcomeMessage } from '../../lib/invitationOutcome'
import type { AdminUser, AdminTimeCategory, ApprovalGroup, ApprovalGroupOption } from '../../lib/api'
import { formatDateTime } from '../../lib/dateUtils'
import RolePicker from '../../components/team/RolePicker'
import MyPaySwitch from '../../components/team/MyPaySwitch'
import { TeamList } from '../../components/team/TeamList'
import { Button, EmptyState, ErrorState, Field, FilterBar, PageHeader, Select } from '../../components/ui'
import { Skeleton } from '../../components/ui/Skeleton'
import { useMediaQuery } from '../../lib/useMediaQuery'
import { isUserRole, ROLE_DETAILS, roleRequiresPersonalAccess, rolesAssignableToNewPerson, USER_ROLES, type UserRole } from '../../lib/roles'
import { useCapabilities } from '../../lib/useCapabilities'
import { teamCountSummary } from '../../components/team/teamCounts'

export default function Users() {
  useEffect(() => {
    document.title = 'Team | AIRE Ops'
  }, [])

  const { userRole, isClerkEnabled } = useAuthContext()
  const capabilities = useCapabilities()
  const canManageMyPay = capabilities.manage_my_pay_access
  const createRoleOptions = rolesAssignableToNewPerson(isClerkEnabled ? userRole : 'owner')
  const [query, setQuery] = useSearchParams()
  const navigate = useNavigate()
  const location = useLocation()
  // On phones My Pay is on the person's Access and Pay tabs, not in the list.
  const desktop = useMediaQuery('(min-width: 1024px)')
  const setFilter = (key: string, value: string) => setQuery((previous) => {
    const next = new URLSearchParams(previous)
    next.set(key, value)
    return next
  }, { replace: true })
  const [loadError, setLoadError] = useState('')
  const [loadedAt, setLoadedAt] = useState<string | null>(null)
  const [loadRetry, setLoadRetry] = useState(0)
  const [users, setUsers] = useState<AdminUser[]>([])
  const [allCategories, setAllCategories] = useState<AdminTimeCategory[]>([])
  const [approvalGroupOptions, setApprovalGroupOptions] = useState<ApprovalGroupOption[]>([])
  const [loading, setLoading] = useState(true)
  const searchTerm = query.get('search') || ''
  const setSearchTerm = (value: string) => setFilter('search', value)
  const roleFilter: 'all' | UserRole = isUserRole(query.get('role')) ? query.get('role') as UserRole : 'all'
  const setRoleFilter = (value: string) => setFilter('role', value)
  const statusFilter = (['all', 'active', 'pending', 'inactive', 'terminated'].includes(query.get('status') || '') ? query.get('status') : 'active') as 'all' | 'active' | 'pending' | 'inactive' | 'terminated'
  const setStatusFilter = (value: string) => setFilter('status', value)
  const departmentFilter = (query.get('department') || 'all') as 'all' | 'unassigned' | ApprovalGroup
  const setDepartmentFilter = (value: string) => setFilter('department', value)
  const signInFilter = (['all', 'personal', 'kiosk'].includes(query.get('signin') || '') ? query.get('signin') : 'all') as 'all' | 'personal' | 'kiosk'
  const setSignInFilter = (value: string) => setFilter('signin', value)
  const myPayFilter = (['all', 'on', 'off'].includes(query.get('my_pay') || '') ? query.get('my_pay') : 'all') as 'all' | 'on' | 'off'
  const setMyPayFilter = (value: string) => setFilter('my_pay', value)
  const publicTeamFilter = (['all', 'visible', 'hidden'].includes(query.get('public') || '') ? query.get('public') : 'all') as 'all' | 'visible' | 'hidden'
  const setPublicTeamFilter = (value: string) => setFilter('public', value)

  const [showCreateModal, setShowCreateModal] = useState(false)
  const [createStep, setCreateStep] = useState<1 | 2>(1)
  const [createPersonalAccess, setCreatePersonalAccess] = useState(true)
  const [createTimeTracking, setCreateTimeTracking] = useState(true)
  const [createKioskPin, setCreateKioskPin] = useState('')
  const [createSuccess, setCreateSuccess] = useState<{ message: string; pin?: string | null; userId?: number } | null>(null)
  const [createFirstName, setCreateFirstName] = useState('')
  const [createLastName, setCreateLastName] = useState('')
  const [createEmail, setCreateEmail] = useState('')
  const [createRole, setCreateRole] = useState<UserRole>('employee')
  const [createIsIntern, setCreateIsIntern] = useState(false)
  const [createStaffTitle, setCreateStaffTitle] = useState('')
  const [createApprovalGroups, setCreateApprovalGroups] = useState<Set<ApprovalGroup>>(new Set())
  const [sendInvitationEmail, setSendInvitationEmail] = useState(true)
  const [createCategoryIds, setCreateCategoryIds] = useState<Set<number>>(new Set())
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')

  const [myPayForEveryone, setMyPayForEveryone] = useState<boolean | null>(null)
  const [savingMyPayForEveryone, setSavingMyPayForEveryone] = useState(false)
  const [confirmMyPayForEveryone, setConfirmMyPayForEveryone] = useState(false)
  const [myPaySavingIds, setMyPaySavingIds] = useState<Set<number>>(new Set())
  const [myPayError, setMyPayError] = useState('')

  const createModalRef = useRef<HTMLDivElement>(null)

  const applyFetchedData = useCallback((
    usersRes: Awaited<ReturnType<typeof api.getAdminUsers>>,
    catsRes: Awaited<ReturnType<typeof api.getAdminTimeCategories>>,
    settingsRes: Awaited<ReturnType<typeof api.getAdminAppSettings>>,
  ) => {
    if (usersRes.data) {
      setUsers(usersRes.data.users.filter((u) => isUserRole(u.role)))
      setLoadedAt(new Date().toISOString())
    }
    const failures = [usersRes.error, catsRes.error, settingsRes.error].filter(Boolean)
    setLoadError(failures.length ? `Team data is unavailable: ${failures.join('; ')}. Last successful information is retained.` : '')
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
      } catch (reason) {
        if (!cancelled) setLoadError(reason instanceof Error ? reason.message : 'Unable to load Team data')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    initialLoad()
    return () => { cancelled = true }
  }, [applyFetchedData, loadRetry])

  useEffect(() => {
    if (!canManageMyPay) return
    let cancelled = false
    api.getMyPayAccess().then((response) => {
      if (cancelled) return
      if (response.data) setMyPayForEveryone(response.data.enabled_for_all)
      else setMyPayError(response.error || 'My Pay access could not be loaded.')
    })
    return () => { cancelled = true }
  }, [canManageMyPay, loadRetry])

  // "On the clock" on a row. Without it the rows still work; they just don't say so.
  const [onTheClock, setOnTheClock] = useState<Set<number>>(new Set())
  useEffect(() => {
    let cancelled = false
    void api.getWhosWorking().then((response) => {
      if (cancelled || !response.data) return
      setOnTheClock(new Set(response.data.workers.filter((worker) => worker.status === 'clocked_in' || worker.status === 'on_break').map((worker) => worker.user.id)))
    })
    return () => { cancelled = true }
  }, [loadRetry])

  const toggleMyPayForEveryone = async (enabled: boolean) => {
    setConfirmMyPayForEveryone(false)
    setSavingMyPayForEveryone(true)
    setMyPayError('')
    const response = await api.setMyPayForEveryone(enabled)
    if (response.data) setMyPayForEveryone(response.data.enabled_for_all)
    else setMyPayError(response.error || 'My Pay could not be changed for everyone. Nothing was changed.')
    setSavingMyPayForEveryone(false)
  }

  const toggleUserMyPay = async (user: AdminUser, enabled: boolean) => {
    setMyPaySavingIds((previous) => new Set(previous).add(user.id))
    setMyPayError('')
    const response = await api.setUserMyPay(user.id, enabled)
    if (response.data) {
      const saved = response.data.my_pay_enabled
      setUsers((previous) => previous.map((row) => (row.id === user.id ? { ...row, my_pay_enabled: saved } : row)))
    } else {
      setMyPayError(response.error || `My Pay could not be changed for ${user.full_name || user.display_name}. Nothing was changed.`)
    }
    setMyPaySavingIds((previous) => { const next = new Set(previous); next.delete(user.id); return next })
  }

  const renderMyPaySwitch = (user: AdminUser) => {
    const name = user.full_name || user.display_name
    const inactive = !user.is_active || user.employment_status === 'terminated'
    if (myPayForEveryone && !inactive) {
      return <span className="text-xs font-medium text-cyan-800">On for everyone</span>
    }
    return (
      <span className="inline-flex items-center gap-1.5">
        <MyPaySwitch
          checked={Boolean(user.my_pay_enabled)}
          onChange={(checked) => void toggleUserMyPay(user, checked)}
          label={`My Pay for ${name}`}
          disabled={inactive || myPayForEveryone === null}
          busy={myPaySavingIds.has(user.id)}
        />
        <span className="text-xs text-slate-600">{inactive ? 'Reactivate before turning on My Pay.' : user.my_pay_enabled ? 'On' : 'Off'}</span>
      </span>
    )
  }

  const refreshData = useCallback(async () => {
    try {
      const [usersRes, catsRes, settingsRes] = await Promise.all([
        api.getAdminUsers(), api.getAdminTimeCategories(), api.getAdminAppSettings(),
      ])
      applyFetchedData(usersRes, catsRes, settingsRes)
    } catch (reason) {
      setLoadError(reason instanceof Error ? reason.message : 'Unable to refresh Team data. Last successful information is retained.')
    }
  }, [applyFetchedData])

  const activeCategories = allCategories.filter((c) => c.is_active)
  const createUsesClerkProfile = createPersonalAccess
  const normalizedSearchTerm = searchTerm.trim().toLowerCase()
  const hasActiveFilters = Boolean(
    normalizedSearchTerm ||
    roleFilter !== 'all' ||
    statusFilter !== 'active' ||
    departmentFilter !== 'all' ||
    signInFilter !== 'all' ||
    myPayFilter !== 'all' ||
    publicTeamFilter !== 'all',
  )
  const filteredUsers = useMemo(() => {
    return users.filter((user) => {
      if (roleFilter !== 'all' && user.role !== roleFilter) return false

      if (statusFilter === 'active' && (!user.is_active || user.is_pending)) return false
      if (statusFilter === 'pending' && (!user.is_active || !user.is_pending)) return false
      if (statusFilter === 'inactive' && user.employment_status !== 'inactive') return false
      if (statusFilter === 'terminated' && user.employment_status !== 'terminated') return false

      const userDepartmentKeys = user.approval_group_keys ?? (user.approval_group ? [user.approval_group] : [])
      if (departmentFilter === 'unassigned' && userDepartmentKeys.length > 0) return false
      if (departmentFilter !== 'all' && departmentFilter !== 'unassigned' && !userDepartmentKeys.includes(departmentFilter)) return false

      if (signInFilter === 'personal' && !user.personal_access_enabled) return false
      if (signInFilter === 'kiosk' && user.personal_access_enabled) return false

      if (myPayFilter === 'on' && !(myPayForEveryone || user.my_pay_enabled)) return false
      if (myPayFilter === 'off' && (myPayForEveryone || user.my_pay_enabled)) return false

      if (publicTeamFilter === 'visible' && !(user.is_active && user.public_team_enabled)) return false
      if (publicTeamFilter === 'hidden' && user.is_active && user.public_team_enabled) return false

      if (!normalizedSearchTerm) return true
      const statusTokens = [user.employment_status]

      if (['active', 'inactive', 'pending', 'terminated'].includes(normalizedSearchTerm)) {
        return statusTokens.includes(normalizedSearchTerm as AdminUser['employment_status'])
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
  }, [departmentFilter, myPayFilter, myPayForEveryone, normalizedSearchTerm, publicTeamFilter, roleFilter, signInFilter, statusFilter, users])

  const resetFilters = () => {
    const next = new URLSearchParams(query)
    for (const key of ['search', 'role', 'status', 'department', 'signin', 'my_pay', 'public']) next.delete(key)
    setQuery(next, { replace: true })
  }

  const activeCount = users.filter((user) => user.is_active).length
  const activeFilterCount = [roleFilter !== 'all', statusFilter !== 'active', departmentFilter !== 'all', signInFilter !== 'all', myPayFilter !== 'all', publicTeamFilter !== 'all'].filter(Boolean).length
  const teamFilters = (
    <>
      <Field label="Department">
        <Select value={departmentFilter} onChange={(event) => setDepartmentFilter(event.target.value)}>
          <option value="all">All departments</option>
          <option value="unassigned">No department</option>
          {approvalGroupOptions.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
        </Select>
      </Field>
      <Field label="Role">
        <Select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)}>
          <option value="all">All roles</option>
          {USER_ROLES.map((role) => <option key={role} value={role}>{ROLE_DETAILS[role].plural}</option>)}
        </Select>
      </Field>
      <Field label="Sign-in">
        <Select value={signInFilter} onChange={(event) => setSignInFilter(event.target.value)}>
          <option value="all">Everyone</option>
          <option value="personal">Personal sign-in</option>
          <option value="kiosk">Kiosk only</option>
        </Select>
      </Field>
      {canManageMyPay && (
        <Field label="My Pay">
          <Select value={myPayFilter} onChange={(event) => setMyPayFilter(event.target.value)}>
            <option value="all">Everyone</option>
            <option value="on">My Pay on</option>
            <option value="off">My Pay off</option>
          </Select>
        </Field>
      )}
      <Field label="Status">
        <Select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
          <option value="active">Active</option>
          <option value="pending">Hasn't signed in yet</option>
          <option value="inactive">Inactive</option>
          <option value="terminated">Ended</option>
          <option value="all">Everyone</option>
        </Select>
      </Field>
      <Field label="On the website">
        <Select value={publicTeamFilter} onChange={(event) => setPublicTeamFilter(event.target.value)}>
          <option value="all">Everyone</option>
          <option value="visible">Shown on the Team page</option>
          <option value="hidden">Hidden</option>
        </Select>
      </Field>
    </>
  )

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
        const inviteNote = createPersonalAccess
          ? invitationOutcomeMessage(response.data, sendInvitationEmail)
          : 'They can use the kiosk immediately with the PIN below.'
        setCreateSuccess({ message: inviteNote, pin: response.data?.kiosk_pin, userId: response.data?.user?.id })
        void refreshData()
      }
    } catch {
      setCreateError('Failed to create team member')
    } finally {
      setCreating(false)
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

  useDialogFocus(showCreateModal, createModalRef, () => {
    if (!creating) { setShowCreateModal(false); resetCreateForm() }
  })
  const editId = query.get('edit_user_id')
  if (editId && /^[1-9]\d*$/.test(editId)) {
    const destination = new URLSearchParams({ tab: 'access' })
    if (query.get('return_to')) destination.set('return_to', safeAdminReturn(query.get('return_to')))
    return <Navigate replace to={`/admin/users/${editId}?${destination}`} />
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Team"
        description={loadedAt ? `${activeCount} active` : undefined}
        actions={<Button icon={<UserPlus className="size-4" />} onClick={() => setShowCreateModal(true)}>Add person</Button>}
      />

      {query.get('return_to') && <Link className="inline-flex min-h-11 items-center text-body-sm font-semibold text-primary hover:underline" to={safeAdminReturn(query.get('return_to'))}>Back to employee</Link>}
      {loadError && (
        <ErrorState
          title="Team data is unavailable."
          description={`${loadError}${loadedAt ? ` Last refreshed ${formatDateTime(loadedAt)}.` : ''}`}
          onRetry={() => setLoadRetry((value) => value + 1)}
          retryLabel="Retry"
        />
      )}
      {canManageMyPay && loadedAt && (
        <section aria-labelledby="my-pay-access-title" className="rounded-card border border-line bg-surface px-4 py-2">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
            <div className="min-w-0 py-1.5">
              <h2 id="my-pay-access-title" className="text-body-sm font-semibold text-ink">My Pay</h2>
              <p className="text-body-sm text-ink-muted">
                {myPayForEveryone === null
                  ? 'Loading who can see their own pay statements…'
                  : myPayForEveryone
                    ? 'Every active team member can see their own pay statements.'
                    : `${users.filter((user) => user.is_active && user.my_pay_enabled).length} of ${activeCount} active team members can see their own pay statements.`}
              </p>
            </div>
            <span className="inline-flex items-center gap-2">
              <span className="text-body-sm font-medium text-ink">On for everyone</span>
              <MyPaySwitch
                checked={Boolean(myPayForEveryone)}
                onChange={(checked) => { if (checked) setConfirmMyPayForEveryone(true); else void toggleMyPayForEveryone(false) }}
                label="My Pay on for everyone"
                disabled={myPayForEveryone === null}
                busy={savingMyPayForEveryone}
              />
            </span>
          </div>
          {myPayError && <p role="alert" className="pb-2 text-body-sm font-medium text-danger">{myPayError}</p>}
          {confirmMyPayForEveryone && (
            <div role="group" aria-label="Confirm My Pay for everyone" className="mb-2 rounded-control border border-amber-200 bg-amber-50 p-3 text-body-sm text-amber-950">
              <p>Everyone active, {activeCount} people, will see their own pay statements right away.</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button size="sm" onClick={() => void toggleMyPayForEveryone(true)}>Turn on for everyone</Button>
                <Button size="sm" variant="secondary" onClick={() => setConfirmMyPayForEveryone(false)}>Cancel</Button>
              </div>
            </div>
          )}
        </section>
      )}

      {loading ? (
        <div aria-busy="true" aria-label="Loading the team" className="space-y-2 rounded-card border border-line bg-surface p-4">
          {Array.from({ length: 6 }, (_, index) => <Skeleton key={index} height={44} className="w-full" />)}
        </div>
      ) : loadError && !loadedAt ? null : users.length === 0 ? (
        <EmptyState title="No team members yet." action={<Button onClick={() => setShowCreateModal(true)}>Add person</Button>} />
      ) : (
        <>
          <FilterBar
            search={{ value: searchTerm, onChange: setSearchTerm, label: 'Search name or email', placeholder: 'Search name or email' }}
            moreFilters={teamFilters}
            activeFilterCount={activeFilterCount}
            onClear={resetFilters}
            resultSummary={hasActiveFilters ? teamCountSummary(filteredUsers.length, users) : undefined}
          />
          {filteredUsers.length === 0 ? (
            <EmptyState title="No one matches." description="Try another name, or clear the filters." action={<Button variant="secondary" onClick={resetFilters}>Clear filters</Button>} />
          ) : (
            <TeamList
              users={filteredUsers}
              onTheClock={onTheClock}
              returnTo={`${location.pathname}${location.search}`}
              myPay={canManageMyPay && desktop ? renderMyPaySwitch : undefined}
            />
          )}
        </>
      )}

      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-3 sm:p-6" role="presentation">
          <div ref={createModalRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="create-user-title" className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
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
                {createSuccess.userId && (
                  <button
                    type="button"
                    onClick={() => {
                      const createdId = createSuccess.userId!
                      setShowCreateModal(false)
                      resetCreateForm()
                      navigate(employeeWorkspaceHref(createdId, { returnTo: `${location.pathname}${location.search}` }))
                    }}
                    className="mt-7 w-full rounded-xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800"
                  >
                    Open their page
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => { setShowCreateModal(false); resetCreateForm() }}
                  className={createSuccess.userId
                    ? 'mt-3 w-full rounded-xl border border-slate-300 px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50'
                    : 'mt-7 w-full rounded-xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800'}
                >
                  Done
                </button>
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
                      <RolePicker
                        value={createRole}
                        options={createRoleOptions}
                        onChange={(role) => {
                          setCreateRole(role)
                          if (roleRequiresPersonalAccess(role)) setCreatePersonalAccess(true)
                        }}
                      />

                      <fieldset>
                        <legend className="text-sm font-medium text-slate-700">How will this person access AIRE Ops?</legend>
                        <div className="mt-3 grid gap-3 sm:grid-cols-2">
                          <label className={`cursor-pointer rounded-2xl border p-4 transition ${createPersonalAccess ? 'border-cyan-500 bg-cyan-50/70 ring-2 ring-cyan-100' : 'border-slate-200 hover:border-slate-300'}`}>
                            <input type="radio" name="create-access" checked={createPersonalAccess} onChange={() => { setCreatePersonalAccess(true); setSendInvitationEmail(true) }} className="sr-only" />
                            <span className="block text-sm font-semibold text-slate-900">Personal account</span>
                            <span className="mt-1 block text-xs leading-5 text-slate-600">They sign in with email. Clerk supplies their name after activation.</span>
                          </label>
                          <label className={`rounded-2xl border p-4 transition ${roleRequiresPersonalAccess(createRole) ? 'cursor-not-allowed bg-slate-50 opacity-50' : 'cursor-pointer'} ${!createPersonalAccess ? 'border-cyan-500 bg-cyan-50/70 ring-2 ring-cyan-100' : 'border-slate-200 hover:border-slate-300'}`}>
                            <input type="radio" name="create-access" checked={!createPersonalAccess} disabled={roleRequiresPersonalAccess(createRole)} onChange={() => { setCreateRole('employee'); setCreatePersonalAccess(false); setSendInvitationEmail(false); setCreateTimeTracking(true) }} className="sr-only" />
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
                          {!createPersonalAccess && <div><label htmlFor="create-kiosk-pin" className="mb-2 block text-sm font-medium text-slate-700">Kiosk PIN <span className="text-xs font-normal text-slate-500">(optional)</span></label><input id="create-kiosk-pin" inputMode="numeric" pattern="[0-9]{4,8}" value={createKioskPin} onChange={(event) => setCreateKioskPin(event.target.value.replace(/\D/g, '').slice(0, 8))} placeholder="Generate automatically" className="w-full rounded-xl border border-slate-300 px-4 py-3 font-mono text-sm tracking-widest outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-100" /><p className="mt-2 text-xs text-slate-500">Leave blank to generate a secure six-digit PIN that is shown once after creation.</p></div>}
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

    </div>
  )
}
