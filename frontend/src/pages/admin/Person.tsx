import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { CalendarClock, KeyRound, Send, Wallet } from 'lucide-react'
import { AccessTab } from '../../components/person/AccessTab'
import { EmploymentTab } from '../../components/person/EmploymentTab'
import { OverviewTab } from '../../components/person/OverviewTab'
import { PayTab } from '../../components/person/PayTab'
import { PersonHeader } from '../../components/person/PersonHeader'
import { ResetPinSheet } from '../../components/person/ResetPinSheet'
import { TimeTab } from '../../components/person/TimeTab'
import { personName } from '../../components/person/personFormat'
import { dataOrThrow, useLoadable } from '../../components/person/useLoadable'
import SendPayStubDialog from '../../components/pay-stubs/SendPayStubDialog'
import { EmptyState, ErrorState, Sheet, Button, Tabs, buttonClasses, useConfirm, useToast, type MenuItem } from '../../components/ui'
import { Skeleton } from '../../components/ui/Skeleton'
import { useAuthContext } from '../../contexts/AuthContext'
import { api, type AdminUser } from '../../lib/api'
import { peopleApi } from '../../lib/api/people'
import { employeeEvidenceApi } from '../../lib/employeeEvidenceApi'
import { LEGACY_TAB_ALIASES, linkedId, safeAdminReturn, type PersonTab } from '../../lib/employeeWorkspace'
import { currentPayPeriod, todayInGuam } from '../../lib/payPeriods'
import { useCapabilities } from '../../lib/useCapabilities'

// The refusal main showed for a saved link whose employee or installation changed.
const SAVED_LINK_MISMATCH = 'This saved employee link no longer matches the source installation or employee. Return to payroll and refresh the connection evidence.'

const TAB_ITEMS: Array<{ value: PersonTab; label: string }> = [
  { value: 'overview', label: 'Overview' },
  { value: 'time', label: 'Time' },
  { value: 'pay', label: 'Pay' },
  { value: 'access', label: 'Access' },
  { value: 'employment', label: 'Employment' },
]

/**
 * One person: Overview, Time, Pay, Access and Employment. Old links keep
 * working: `?tab=hours` (Cornerstone Payroll's evidence link, with `period`
 * and `entry`) and `?tab=schedule` open Time, `?tab=setup` opens Access, and
 * `?tab=activity` opens Overview at Recent activity.
 */
export default function Person() {
  const { id = '' } = useParams()
  const userId = linkedId(id)
  const [searchParams] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()
  const capabilities = useCapabilities()
  const { currentUser } = useAuthContext()
  const toast = useToast()
  const [confirm, confirmDialog] = useConfirm()
  const today = todayInGuam()
  const period = useMemo(() => currentPayPeriod(), [])
  // Read once: the tab rewrites ?tab=activity to overview on arrival.
  const [focusActivity] = useState(() => searchParams.get('tab') === 'activity' || location.hash === '#activity')
  const [retry, setRetry] = useState(0)
  const [myPayRetry, setMyPayRetry] = useState(0)
  const [generatedPin, setGeneratedPin] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [resettingPin, setResettingPin] = useState(false)
  const personKey = userId ? `${userId}:${retry}` : null
  // Null for a 404: there's no such person.
  const loaded = useLoadable(personKey, async () => {
    const response = await peopleApi.person(userId!)
    if (response.status === 404) return null
    return dataOrThrow(response, 'Unknown error').user
  }, 'Unknown error')
  // A saved link from payroll names the employee and installation it was made
  // for. It opens only while both still match, before any tab renders.
  const sourceUserUuid = searchParams.get('source_user_uuid') || ''
  const sourceInstanceId = searchParams.get('source_instance_id') || ''
  const identityKey = userId && (sourceUserUuid || sourceInstanceId) ? `${userId}:${sourceUserUuid}:${sourceInstanceId}:${retry}` : null
  const identity = useLoadable(identityKey, async (signal) => {
    const result = await employeeEvidenceApi.periods(String(userId), new URLSearchParams({ per_page: '1' }), signal)
    if (result.employee?.id !== String(userId)) throw new Error('Employee evidence identity does not match this record.')
    if ((sourceUserUuid && result.employee.payroll_integration_id !== sourceUserUuid) || (sourceInstanceId && result.integration?.source_instance_id !== sourceInstanceId)) {
      throw new Error(SAVED_LINK_MISMATCH)
    }
    return true
  }, 'Unable to check this saved link.')
  // The person after a change on this page (My Pay, a new PIN), until the next load.
  const [latest, setLatest] = useState<{ key: string; user: AdminUser } | null>(null)

  const canManageMyPay = capabilities.manage_my_pay_access
  // "On for everyone"; unknown (null) until it loads or when it didn't.
  const myPayAccess = useLoadable(
    canManageMyPay ? String(myPayRetry) : null,
    async () => dataOrThrow(await api.getMyPayAccess(), "Couldn't load the My Pay settings.").enabled_for_all,
    "Couldn't load the My Pay settings.",
  )
  const myPayForEveryone = myPayAccess.status === 'ready' ? myPayAccess.value : null
  const myPayError = myPayAccess.status === 'error' ? myPayAccess.message : null

  const user = latest && latest.key === personKey ? latest.user : loaded.status === 'ready' ? loaded.value : null
  const name = user ? personName(user) : ''
  useEffect(() => { document.title = name ? `${name} | AIRE Team` : 'Team | AIRE Ops' }, [name])

  // A quiet reload after a change elsewhere on the page (a new PIN).
  const refreshUser = useCallback(() => {
    if (!userId || !personKey) return
    void peopleApi.person(userId).then((response) => {
      if (response.data?.user) setLatest({ key: personKey, user: response.data.user })
    })
  }, [personKey, userId])

  const returnTo = safeAdminReturn(searchParams.get('return_to'))
  const backLabel = returnTo.split('?')[0] === '/admin/users' ? 'Team' : 'Back'
  const currentPath = `${location.pathname}${location.search}`

  if (!userId || (loaded.status === 'ready' && loaded.value === null)) {
    return (
      <EmptyState
        className="mt-6"
        title="We couldn't find that person."
        description="They may have been removed, or the link is incomplete."
        action={<Link to="/admin/users" className={buttonClasses({ variant: 'secondary' })}>Back to Team</Link>}
      />
    )
  }
  if (identity.status === 'error') {
    return (
      <ErrorState
        className="mt-6"
        title="Couldn't open this saved link."
        description={identity.message}
        onRetry={() => setRetry(value => value + 1)}
      />
    )
  }
  if (loaded.status === 'error') {
    return <ErrorState className="mt-6" title="Couldn't load this person." description={loaded.message} onRetry={() => setRetry(value => value + 1)} />
  }
  if (!user || (identityKey && identity.status === 'loading')) {
    return (
      <div aria-busy="true" aria-label="Loading this person" className="space-y-4">
        <Skeleton height={20} className="w-24" />
        <div className="flex items-center gap-3"><Skeleton height={48} className="w-12 rounded-full" /><Skeleton height={28} className="w-56" /></div>
        <Skeleton height={44} className="w-full" />
        <Skeleton height={160} className="w-full" />
      </div>
    )
  }

  const ended = user.employment_status === 'terminated'
  const canChangeAccess = user.can_change_access !== false
  const previewHref = capabilities.preview_pay && currentUser?.my_pay_preview_enabled ? `/admin/pay-preview/${user.id}` : null
  const canResetPin = user.time_tracking_enabled && Boolean(user.kiosk_enabled) && canChangeAccess && !ended && user.is_active
  const sendStub = capabilities.send_pay_statements ? () => setSending(true) : undefined
  const activityHref = `/admin/activity?${new URLSearchParams({ subject_type: 'User', subject_id: String(user.id), return_to: currentPath })}`
  const tabHref = (tab: PersonTab, extra: Record<string, string> = {}) => {
    const next = new URLSearchParams({ tab, ...extra })
    if (searchParams.get('return_to')) next.set('return_to', returnTo)
    return `?${next}`
  }

  const preview: MenuItem | null = previewHref ? { id: 'preview', label: 'Preview their My Pay', icon: <Wallet className="size-4" />, onSelect: () => navigate(previewHref) } : null
  const resetPin: MenuItem | null = canResetPin ? { id: 'pin', label: 'Reset kiosk PIN', icon: <KeyRound className="size-4" />, onSelect: () => setResettingPin(true) } : null
  const menuItems = [
    preview,
    resetPin,
    capabilities.manage_team_time && user.time_tracking_enabled
      ? { id: 'timecards', label: 'Open in Timecards', icon: <CalendarClock className="size-4" />, onSelect: () => navigate(`/admin/timecards?${new URLSearchParams({ user_id: String(user.id), period: period.start })}`) }
      : null,
  ].filter((item): item is MenuItem => item !== null)
  const quickActions = [
    sendStub ? { id: 'stub', label: 'Send pay stub', icon: <Send className="size-4" />, onSelect: sendStub } : null,
    preview,
    resetPin,
  ].filter((item): item is MenuItem => item !== null)

  const deleteProfile = async () => {
    const remove = await confirm({
      title: `Delete the unused profile for ${name}?`,
      description: 'This is only allowed before any work or payroll history exists.',
      tone: 'danger',
      confirmLabel: 'Delete profile',
    })
    if (!remove) return
    const response = await api.deleteUser(user.id)
    if (response.error) { toast.show({ message: response.error }); return }
    toast.show({ message: `Deleted ${name}'s profile.` })
    navigate('/admin/users', { replace: true })
  }

  return (
    <div className="space-y-5">
      <PersonHeader
        user={user}
        myPayOn={!user.is_active ? false : user.my_pay_enabled || myPayForEveryone ? true : myPayForEveryone === null && canManageMyPay ? null : false}
        backTo={returnTo}
        backLabel={backLabel}
        onSendStub={sendStub}
        menuItems={menuItems}
      />

      <Tabs
        label={name}
        items={TAB_ITEMS}
        aliases={LEGACY_TAB_ALIASES}
        className="[&>[role=tablist]]:[mask-image:linear-gradient(to_right,#000_calc(100%-2rem),transparent)] sm:[&>[role=tablist]]:[mask-image:none]"
      >
        {(tab) => {
          if (tab === 'time') return <TimeTab user={user} today={today} />
          if (tab === 'pay') {
            return (
              <PayTab
                user={user}
                today={today}
                myPayForEveryone={myPayForEveryone}
                myPayError={myPayError}
                onRetryMyPay={() => setMyPayRetry(value => value + 1)}
                canManageMyPay={canManageMyPay}
                previewHref={previewHref}
                onSendStub={sendStub}
                onUserChange={(next) => { if (personKey) setLatest({ key: personKey, user: next }) }}
              />
            )
          }
          if (tab === 'access') {
            return (
              <AccessTab
                key={`${user.id}:access`}
                user={user}
                onSaved={(next, pin) => { if (personKey) setLatest({ key: personKey, user: next }); if (pin) setGeneratedPin(pin) }}
                myPayForEveryone={myPayForEveryone}
                myPayError={myPayError}
                onResetPin={canResetPin ? () => setResettingPin(true) : undefined}
                onDelete={() => void deleteProfile()}
              />
            )
          }
          if (tab === 'employment') return <EmploymentTab key={`${user.id}:employment`} user={user} onSaved={(next, pin) => { if (personKey) setLatest({ key: personKey, user: next }); if (pin) setGeneratedPin(pin) }} />
          return (
            <OverviewTab
              user={user}
              period={period}
              today={today}
              timecardHref={tabHref('time', { period: period.start })}
              activityHref={activityHref}
              focusActivity={focusActivity}
              quickActions={quickActions}
            />
          )
        }}
      </Tabs>

      {sending && (
        <SendPayStubDialog
          workerId={user.id}
          canChooseRecipient={capabilities.preview_pay}
          onClose={() => setSending(false)}
          onSent={() => undefined}
        />
      )}
      <ResetPinSheet
        open={resettingPin}
        userId={user.id}
        version={user.admin_edit_version ?? 0}
        name={name}
        onClose={() => setResettingPin(false)}
        onReset={refreshUser}
      />
      <Sheet open={Boolean(generatedPin)} title="New kiosk PIN" onClose={() => setGeneratedPin(null)} footer={<Button onClick={() => setGeneratedPin(null)}>Done</Button>}>
        <p className="text-body-sm">Share this PIN privately. It is shown only once.</p><p className="mt-3 font-mono text-title tracking-widest">{generatedPin}</p>
      </Sheet>
      {confirmDialog}
    </div>
  )
}
