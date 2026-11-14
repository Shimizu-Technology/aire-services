import { outcomeUnknown } from '../../lib/api/timecards'
import { LiveTimer } from '../../components/ui/LiveTimer'
import { ClockActions } from '../../components/clock/ClockActions'
import { WorkChips } from '../../components/clock/WorkChips'
import PayrollCutoffNotice from '../../components/time-tracking/PayrollCutoffNotice'
import type { PayrollCutoffResponse } from '../../lib/api'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { SignInButton } from '@clerk/clerk-react'
import { api, type AireKioskActionResponse, type AireKioskEmployee, type ClockStatus, type TimeCategory } from '../../lib/api'
import { useAuthContext } from '../../contexts/AuthContext'
import { capabilitiesFor } from '../../lib/roles'
import KioskPayStubRequest from '../../components/pay-stubs/KioskPayStubRequest'

type KioskAction = 'clock_in' | 'clock_out' | 'start_break' | 'end_break' | 'switch_category'

const keypad = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0', 'CLR']
const PIN_LENGTH = 8
const IDLE_RESET_MS = 30_000
const SUCCESS_RESET_MS = 8_000
const KIOSK_ACCESS_STORAGE_KEY = 'aire_kiosk_access_session'

interface StoredKioskAccessSession {
  token: string
  expiresAt: string
  unlockedBy: string
}

function formatActionLabel(action: KioskAction) {
  switch (action) {
    case 'clock_in':
      return 'Clock In'
    case 'clock_out':
      return 'Clock Out'
    case 'start_break':
      return 'Start Break'
    case 'end_break':
      return 'End Break'
    case 'switch_category':
      return 'Switch Category'
  }
}

function formatSuccessMessage(action: KioskAction, employee: AireKioskEmployee, category?: TimeCategory | null) {
  switch (action) {
    case 'clock_in':
      return `${employee.display_name} clocked in${category ? ` for ${category.name}` : ''}.`
    case 'clock_out':
      return `${employee.display_name} clocked out successfully.`
    case 'start_break':
      return `${employee.display_name} is now on break.`
    case 'end_break':
      return `${employee.display_name} is back from break.`
    case 'switch_category':
      return `${employee.display_name} switched to ${category?.name ?? 'new category'}.`
  }
}

function formatStatus(status: ClockStatus | null) {
  if (!status?.clocked_in) return 'Off the clock'
  if (status.status === 'on_break') return 'On break'
  return 'On the clock'
}

export default function AireKiosk() {
  const { isClerkEnabled, isSignedIn, userRole } = useAuthContext()
  const [cutoffNotice, setCutoffNotice] = useState<PayrollCutoffResponse | null>(null)
  const [pin, setPin] = useState('')
  const [employee, setEmployee] = useState<AireKioskEmployee | null>(null)
  const [kioskToken, setKioskToken] = useState<string | null>(null)
  const [categories, setCategories] = useState<TimeCategory[]>([])
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null)
  const [status, setStatus] = useState<ClockStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [actionLoading, setActionLoading] = useState<KioskAction | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [now, setNow] = useState(() => new Date())
  const [unlocking, setUnlocking] = useState(false)
  const [requestingStub, setRequestingStub] = useState(false)
  // "Pay stub requests at the kiosk" in Settings; off until an owner or admin turns it on.
  const [payStubRequestsEnabled, setPayStubRequestsEnabled] = useState(false)
  const [kioskAccessSession, setKioskAccessSession] = useState<StoredKioskAccessSession | null>(() => {
    if (typeof window === 'undefined') return null
    const raw = window.sessionStorage.getItem(KIOSK_ACCESS_STORAGE_KEY)
    if (!raw) return null

    try {
      const parsed = JSON.parse(raw) as StoredKioskAccessSession
      if (new Date(parsed.expiresAt).getTime() <= Date.now()) {
        window.sessionStorage.removeItem(KIOSK_ACCESS_STORAGE_KEY)
        return null
      }
      return parsed
    } catch {
      window.sessionStorage.removeItem(KIOSK_ACCESS_STORAGE_KEY)
      return null
    }
  })
  const verifiedPinRef = useRef('')
  const sessionGeneration = useRef(0)
  const warningRequestRef = useRef(0)
  const idleResetRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const successResetRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const maskedPin = useMemo(() => (pin.length ? '•'.repeat(pin.length) : '--------'), [pin])

  const selectedCategory = useMemo(
    () => categories.find((category) => category.id === selectedCategoryId) ?? null,
    [categories, selectedCategoryId],
  )
  const kioskAccessToken = !isClerkEnabled ? null : kioskAccessSession?.token ?? null
  const kioskUnlocked = !isClerkEnabled || !!kioskAccessToken
  const canUnlockKiosk = !isClerkEnabled || capabilitiesFor(userRole).unlock_kiosk
  const canViewKiosk = canUnlockKiosk || kioskUnlocked

  const clearSession = useCallback(() => {
    sessionGeneration.current += 1
    verifiedPinRef.current = ''
    warningRequestRef.current += 1
    setPin('')
    setCutoffNotice(null)
    setEmployee(null)
    setKioskToken(null)
    setCategories([])
    setSelectedCategoryId(null)
    setStatus(null)
    setLoading(false)
    setActionLoading(null)
    setError(null)
    setSuccess(null)
    setRequestingStub(false)
    setPayStubRequestsEnabled(false)
  }, [])

  const clearExpiredKioskAccessSession = useCallback(() => {
    if (!kioskAccessSession) return
    if (new Date(kioskAccessSession.expiresAt).getTime() > Date.now()) return

    window.sessionStorage.removeItem(KIOSK_ACCESS_STORAGE_KEY)
    setKioskAccessSession(null)
    clearSession()
  }, [clearSession, kioskAccessSession])

  const bumpIdleTimer = () => {
    if (idleResetRef.current) clearTimeout(idleResetRef.current)
    idleResetRef.current = setTimeout(() => {
      clearSession()
    }, IDLE_RESET_MS)
  }

  useEffect(() => {
    bumpIdleTimer()
    return () => {
      if (idleResetRef.current) clearTimeout(idleResetRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin, employee, kioskToken, selectedCategoryId, status?.status, status?.clocked_in])

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    clearExpiredKioskAccessSession()
  }, [clearExpiredKioskAccessSession, kioskAccessSession])

  useEffect(() => {
    if (!kioskAccessSession) return

    const interval = setInterval(() => {
      clearExpiredKioskAccessSession()
    }, 60_000)

    return () => clearInterval(interval)
  }, [clearExpiredKioskAccessSession, kioskAccessSession])

  useEffect(() => {
    if (!success) return
    if (successResetRef.current) clearTimeout(successResetRef.current)
    successResetRef.current = setTimeout(() => {
      clearSession()
    }, SUCCESS_RESET_MS)

    return () => {
      if (successResetRef.current) clearTimeout(successResetRef.current)
    }
  }, [clearSession, success])

  const applyResponse = (response: AireKioskActionResponse, forceCategory = false) => {
    setEmployee(response.employee)
    setStatus(response.current_status)
    setCategories(response.available_categories)
    if (forceCategory) {
      setSelectedCategoryId(response.time_entry.time_category?.id ?? response.current_status.time_category?.id ?? null)
    } else {
      setSelectedCategoryId((current) => current ?? response.time_entry.time_category?.id ?? response.current_status.time_category?.id ?? null)
    }
  }

  const press = (key: string) => {
    setError(null)
    setSuccess(null)

    if (employee) return
    if (key === 'CLR') {
      setPin('')
      return
    }
    if (key === '⌫') {
      setPin((value) => value.slice(0, -1))
      return
    }
    if (pin.length >= PIN_LENGTH) return
    setPin((value) => value + key)
  }

  // Optional warning reads cannot change the result of a clock command. Ignore
  // responses from an earlier employee or one superseded by an action in flight.
  const requestCutoffNotice = async (employeeToken: string) => {
    const request = ++warningRequestRef.current
    const result = await api.getPayrollCutoff(kioskAccessToken || '', employeeToken)
    if (request === warningRequestRef.current) setCutoffNotice(result.data ?? null)
  }

  const handleVerify = async () => {
    if (!kioskUnlocked) {
      setError('Kiosk is locked. Ask a manager or admin to unlock it first.')
      return
    }

    if (pin.length < 4) {
      setError('Enter your full staff PIN first.')
      return
    }

    setLoading(true)
    setError(null)
    setSuccess(null)

    const result = await api.aireKioskVerify(pin, kioskAccessToken || '')
    if (result.error || !result.data) {
      setError(result.error || 'PIN verification failed.')
      if (result.error?.match(/kiosk is locked/i)) {
        setKioskAccessSession(null)
        if (typeof window !== 'undefined') window.sessionStorage.removeItem(KIOSK_ACCESS_STORAGE_KEY)
      }
      setLoading(false)
      return
    }

    verifiedPinRef.current = pin
    setEmployee(result.data.employee)
    setKioskToken(result.data.kiosk_token)
    setPayStubRequestsEnabled(result.data.pay_stub_requests_enabled === true)
    setStatus(result.data.current_status)
    setCategories(result.data.available_categories)
    setSelectedCategoryId(
      result.data.current_status.time_category?.id
        ?? (result.data.available_categories.length === 1 ? result.data.available_categories[0].id : null),
    )
    setPin('')
    setLoading(false)
    void requestCutoffNotice(result.data.kiosk_token)
  }

  const runAction = async (action: KioskAction) => {
    if (!kioskUnlocked) {
      setError('Kiosk is locked. Ask a manager or admin to unlock it first.')
      return
    }

    if (!kioskToken || !employee) {
      setError('Session expired. Please enter your PIN again.')
      return
    }

    if (action === 'clock_in' && categories.length === 0) {
      setError('No work categories are assigned. Please ask an admin to assign your categories before clocking in.')
      return
    }

    if (action === 'clock_in' && !selectedCategoryId) {
      setError('Choose a work category before clocking in.')
      return
    }

    warningRequestRef.current += 1
    setCutoffNotice(null)
    setActionLoading(action)
    setError(null)
    setSuccess(null)

    const request = (() => {
      switch (action) {
        case 'clock_in':
          return api.aireKioskClockIn(kioskAccessToken || '', kioskToken, selectedCategoryId)
        case 'clock_out':
          return api.aireKioskClockOut(kioskAccessToken || '', kioskToken)
        case 'start_break':
          return api.aireKioskStartBreak(kioskAccessToken || '', kioskToken)
        case 'end_break':
          return api.aireKioskEndBreak(kioskAccessToken || '', kioskToken)
        case 'switch_category':
          return api.aireKioskSwitchCategory(kioskAccessToken || '', kioskToken, selectedCategoryId!)
      }
    })()

    const generation = sessionGeneration.current
    const result = await request
    if (generation !== sessionGeneration.current) return
    if (result.error || !result.data) {
      if (outcomeUnknown(result) || !result.error) {
        // Verify is the kiosk's existing status read. Never retry a punch whose
        // response may have been lost after the server saved it.
        const refreshed = await api.aireKioskVerify(verifiedPinRef.current, kioskAccessToken || '')
        if (generation !== sessionGeneration.current) return
        if (!refreshed.data || refreshed.error) {
          clearSession()
          setError('Could not check your clock status. Enter your PIN again before trying another action.')
          return
        }
        setStatus(refreshed.data.current_status)
        setKioskToken(refreshed.data.kiosk_token)
        setCategories(refreshed.data.available_categories)
        setSelectedCategoryId(refreshed.data.current_status.time_category?.id ?? null)
        setError('The response was lost. Your clock status has been checked. Review it before trying again.')
      } else {
        setError(result.error || `${formatActionLabel(action)} failed.`)
      }
      setActionLoading(null)
      return
    }

    const data = result.data
    window.dispatchEvent(new Event('aire:clock-action'))
    applyResponse(data, action === 'switch_category')
    const responseCategory = data.time_entry.time_category
      ? categories.find((category) => category.id === data.time_entry.time_category?.id) ?? selectedCategory
      : selectedCategory
    setSuccess(formatSuccessMessage(action, data.employee, responseCategory))
    setActionLoading(null)
    void requestCutoffNotice(kioskToken)
  }

  const handleUnlock = async () => {
    if (!canUnlockKiosk) {
      setError('A manager or admin account is required to unlock this kiosk.')
      return
    }

    if (!isClerkEnabled) {
      setError(null)
      return
    }

    setUnlocking(true)
    setError(null)

    const result = await api.createAdminKioskSession()
    if (result.error || !result.data) {
      setError(result.error || 'Failed to unlock the kiosk.')
      setUnlocking(false)
      return
    }

    const session: StoredKioskAccessSession = {
      token: result.data.kiosk_access_token,
      expiresAt: result.data.expires_at,
      unlockedBy: result.data.unlocked_by.full_name,
    }
    window.sessionStorage.setItem(KIOSK_ACCESS_STORAGE_KEY, JSON.stringify(session))
    setKioskAccessSession(session)
    setUnlocking(false)
  }

  const handleLock = () => {
    if (typeof window !== 'undefined') {
      window.sessionStorage.removeItem(KIOSK_ACCESS_STORAGE_KEY)
    }
    setKioskAccessSession(null)
    clearSession()
  }

  const canClockIn = !!employee && !status?.clocked_in && status?.can_clock_in !== false && categories.length > 0 && selectedCategoryId !== null
  const canClockOut = !!employee && !!status?.clocked_in
  const canStartBreak = !!employee && status?.status === 'clocked_in'
  const canEndBreak = !!employee && status?.status === 'on_break'

  const currentCategoryId = status?.time_category?.id ?? null
  const canSwitchCategory = !!employee && !!status?.clocked_in && categories.length > 1
    && selectedCategoryId !== null && selectedCategoryId !== currentCategoryId

  const primaryAction: KioskAction = canEndBreak ? 'end_break' : status?.clocked_in ? 'clock_out' : 'clock_in'
  const primaryEnabled = canEndBreak || (status?.clocked_in ? canClockOut : canClockIn)
  const secondaryActions: KioskAction[] = [
    ...(canStartBreak ? ['start_break' as const] : []),
    ...(canEndBreak ? ['clock_out' as const] : []),
    ...(canSwitchCategory ? ['switch_category' as const] : []),
  ]

  if (!canViewKiosk) {
    return (
      <div className="min-h-screen bg-slate-950 px-4 py-8 text-slate-100 md:px-6 [-webkit-tap-highlight-color:transparent]">
        <div className="mx-auto max-w-3xl">
          <div className="flex items-center justify-end gap-4 text-xs">
            <Link to="/" className="text-slate-500 transition hover:text-slate-300">Home</Link>
          </div>
          <section className="mt-12 rounded-3xl border border-slate-800 bg-slate-900/70 p-8 text-center shadow-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.13em] text-cyan-300">Aire Staff Kiosk</p>
            <h1 className="mt-4 text-3xl font-semibold tracking-tight text-white md:text-4xl">
              Manager or admin launch required
            </h1>
            <p className="mx-auto mt-4 max-w-2xl text-sm text-slate-300 md:text-base">
              This shared kiosk should only be opened by a manager or admin on the device that staff will use.
              Once a manager or admin unlocks it here, employees can enter their PIN until the kiosk is locked again or the unlock session expires.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              {!isClerkEnabled ? (
                <Link
                  to="/admin"
                  className="rounded-xl bg-cyan-400 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300"
                >
                  Open admin workspace
                </Link>
              ) : !isSignedIn ? (
                <SignInButton mode="modal" forceRedirectUrl="/kiosk" fallbackRedirectUrl="/kiosk">
                  <button className="rounded-xl bg-cyan-400 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300">
                    Manager or admin sign in
                  </button>
                </SignInButton>
              ) : (
                <>
                  <div className="rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
                    You are signed in, but only managers and admins can open this kiosk. Ask one to unlock it, or sign out and use a manager or admin account.
                  </div>
                  <Link
                    to="/admin"
                    className="rounded-xl bg-cyan-400 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300"
                  >
                    Back to admin workspace
                  </Link>
                </>
              )}
              <Link
                to="/"
                className="rounded-xl border border-slate-700 px-5 py-3 text-sm font-semibold text-slate-200 transition hover:border-cyan-300 hover:bg-cyan-500/10"
              >
                Back to site
              </Link>
            </div>
          </section>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 [-webkit-tap-highlight-color:transparent]">
      {kioskUnlocked && <div className="mx-auto max-w-6xl px-4 pt-4 md:px-6">
        <PayrollCutoffNotice key={employee?.id ?? 'shared'} kiosk={{ accessToken: kioskAccessToken || '', employeeToken: kioskToken || '', sessionKey: String(employee?.id ?? 'shared'), notice: cutoffNotice }} />
      </div>}
      {/* Staff share this device while it's unlocked; keep them on the kiosk. */}
      {!kioskUnlocked && <div className="mx-auto flex max-w-6xl items-center justify-end gap-4 px-4 pt-3 text-xs md:px-6">
        <Link to="/admin" className="inline-flex min-h-11 items-center text-slate-400 transition hover:text-slate-200">Admin</Link>
        <Link to="/" className="inline-flex min-h-11 items-center text-slate-400 transition hover:text-slate-200">Home</Link>
      </div>}
      <div className={`mx-auto grid w-full gap-8 px-4 pb-8 pt-4 md:px-6 ${employee ? 'max-w-2xl' : 'max-w-6xl md:grid-cols-[1.15fr_1fr]'}`}>
        <section className="order-2 md:order-1 rounded-3xl border border-slate-800 bg-slate-900/60 p-6 md:p-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.13em] text-cyan-300">Aire Staff Kiosk</p>
              <h1 className={`mt-2 text-3xl font-semibold tracking-tight text-white md:text-4xl ${employee ? 'hidden' : ''}`}>Clock in and out quickly</h1>
            </div>
            <div className="rounded-2xl border border-slate-700 bg-slate-950/80 px-4 py-3 text-right">
              <p className="text-xs uppercase tracking-[0.12em] text-slate-400">Guam Time</p>
              <p className="mt-1 text-lg font-semibold text-cyan-200">
                {now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true })}
              </p>
              <p className="text-xs text-slate-400">
                {now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
              </p>
            </div>
          </div>

          <p className={`mt-3 max-w-xl text-sm text-slate-300 md:text-base ${employee ? 'hidden' : ''}`}>
            Enter your staff PIN to clock in or out.
          </p>

          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-950/60 px-4 py-3 text-sm">
            <div>
              <p className="font-semibold text-white">
                {kioskUnlocked ? 'Kiosk unlocked' : 'Kiosk locked'}
              </p>
              <p className="mt-1 text-slate-400">
                {!isClerkEnabled
                  ? 'Local development mode is bypassing the admin unlock requirement.'
                  : kioskAccessSession
                    ? `Unlocked by ${kioskAccessSession.unlockedBy} until ${new Date(kioskAccessSession.expiresAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}.`
                    : 'A manager or admin unlocks this kiosk before staff can enter a PIN.'}
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              {kioskUnlocked ? (
                <button
                  onClick={handleLock}
                  className="rounded-xl border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:border-rose-300 hover:bg-rose-500/10 hover:text-rose-200"
                >
                  Lock kiosk
                </button>
              ) : canUnlockKiosk ? (
                <button
                  onClick={handleUnlock}
                  disabled={unlocking || (isClerkEnabled && !isSignedIn)}
                  className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${
                    unlocking || (isClerkEnabled && !isSignedIn)
                      ? 'cursor-not-allowed bg-slate-800 text-slate-500'
                      : 'bg-cyan-400 text-slate-950 hover:bg-cyan-300'
                  }`}
                >
                  {unlocking ? 'Unlocking…' : 'Unlock kiosk'}
                </button>
              ) : (
                <Link to="/admin" className="rounded-xl border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:border-cyan-300 hover:bg-cyan-500/10">
                  Manager or admin unlock
                </Link>
              )}
            </div>
          </div>

          <div className={`mt-8 rounded-3xl border p-5 ${status?.clocked_in ? 'border-emerald-500/40 bg-emerald-500/10' : 'border-slate-800 bg-slate-950/70'}`}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Current employee</p>
                <p className="mt-1 text-2xl font-semibold text-white">{employee ? employee.full_name : 'Waiting for PIN'}</p>
                <p className="mt-1 text-sm text-cyan-200">{formatStatus(status)}</p>
                {status?.clock_in_at && <div className="mt-3 text-4xl font-semibold text-white"><LiveTimer since={status.active_break_started_at || status.clock_in_at} label={status.status === 'on_break' ? 'Time on break' : 'Time since clock-in'} /></div>}
              </div>
              {employee && (
                <button
                  onClick={clearSession}
                  className="rounded-xl border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:border-cyan-300 hover:bg-cyan-500/10"
                >
                  Not you? Reset
                </button>
              )}
            </div>

            {status?.schedule && (
              <p className="mt-4 text-sm text-slate-300">
                Scheduled today: <span className="font-semibold text-white">{status.schedule.start_time} – {status.schedule.end_time}</span>
              </p>
            )}

            {status?.time_category && (
              <p className="mt-2 text-sm text-slate-300">
                Current work type: <span className="font-semibold text-cyan-200">{status.time_category.name}</span>
              </p>
            )}
          </div>

          {employee && kioskToken && payStubRequestsEnabled && requestingStub ? (
            <KioskPayStubRequest
              kioskAccessToken={kioskAccessToken || ''}
              kioskToken={kioskToken}
              onActivity={bumpIdleTimer}
              onCancel={() => { bumpIdleTimer(); setRequestingStub(false) }}
              onSent={(message) => { setRequestingStub(false); setSuccess(message) }}
            />
          ) : !employee ? (
            <div className="mt-8 rounded-2xl border border-slate-800 bg-slate-900/50 px-4 py-4 text-sm text-slate-400">
              {kioskUnlocked ? 'Verify a PIN to get started.' : 'Unlock the kiosk first, then verify a PIN to get started.'}
            </div>
          ) : categories.length > 0 ? (
            <div className="mt-8 space-y-3">
              {status?.clocked_in && categories.length > 1 && (
                <p className="text-xs text-slate-400">Tap a different category to switch your current work type.</p>
              )}
              <WorkChips dark categories={categories} value={selectedCategoryId} onChange={setSelectedCategoryId} disabled={!!actionLoading} />
            </div>
          ) : (
            <div className="mt-8 rounded-2xl border border-slate-800 bg-slate-900/50 px-4 py-4 text-sm text-slate-300">
              No work categories assigned. Ask an admin to assign your categories before clocking in.
            </div>
          )}

          {employee && !requestingStub && <div className="mt-8"><ClockActions inline>
            <button onClick={() => runAction(primaryAction)} disabled={!primaryEnabled || !!actionLoading || loading}
              className="min-h-14 w-full rounded-2xl bg-cyan-400 px-5 py-4 text-lg font-semibold text-slate-950 disabled:opacity-50 active:scale-[.97]">
              {actionLoading === primaryAction ? `${formatActionLabel(primaryAction)}...` : formatActionLabel(primaryAction)}
            </button>
            <div className="flex flex-wrap gap-3">
              {secondaryActions.map(action => <button key={action} onClick={() => runAction(action)} disabled={!!actionLoading || loading}
                className="min-h-12 flex-1 rounded-xl border border-slate-600 px-4 py-3 font-semibold text-slate-100 disabled:opacity-50">
                {actionLoading === action ? `${formatActionLabel(action)}...` : formatActionLabel(action)}
              </button>)}
            </div>
          </ClockActions></div>}

          {employee && kioskToken && payStubRequestsEnabled && !requestingStub && (
            <button
              type="button"
              onClick={() => { bumpIdleTimer(); setError(null); setSuccess(null); setRequestingStub(true) }}
              disabled={!!actionLoading || loading}
              className="mt-3 w-full rounded-2xl border border-slate-700 px-5 py-3.5 text-sm font-semibold text-slate-200 transition hover:border-cyan-300 hover:bg-cyan-500/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Request my pay stub
            </button>
          )}

          {error && (
            <p className="mt-6 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</p>
          )}

          {success && (
            <p className="mt-6 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">{success}</p>
          )}

          <p className="mt-6 rounded-xl border border-slate-700 bg-slate-900/70 px-4 py-3 text-xs text-slate-300">
            Your name clears after 30 seconds without activity, or 8 seconds after a successful action.
          </p>
        </section>

        {!employee && <section aria-label="Staff PIN" className="order-1 md:order-2 rounded-3xl border border-slate-800 bg-slate-900 p-6 md:p-8">
          <p className="text-xs font-semibold uppercase tracking-[0.13em] text-cyan-300">Enter PIN</p>
          <div className="mt-4 rounded-2xl border border-slate-700 bg-slate-950 px-4 py-4 text-center text-4xl tracking-[0.35em] text-cyan-200">
            {employee ? 'READY' : maskedPin}
          </div>

          <button
            onClick={handleVerify}
            disabled={loading || !kioskUnlocked || !!employee || pin.length < 4}
            className={`mt-4 w-full rounded-2xl px-4 py-3 text-sm font-semibold transition ${
              loading || !kioskUnlocked || employee || pin.length < 4
                ? 'cursor-not-allowed bg-slate-800 text-slate-500'
                : 'bg-cyan-400 text-slate-950 hover:bg-cyan-300'
            }`}
          >
            {loading ? 'Verifying PIN...' : employee ? 'Verified' : 'Verify PIN'}
          </button>

          <div className="mt-6 grid grid-cols-3 gap-3">
            {keypad.map((key) => (
              <button
                key={key}
                onClick={() => press(key)}
                disabled={loading || !!employee}
                className={`rounded-xl border border-slate-700 bg-slate-950 px-4 py-4 text-lg font-semibold text-slate-100 transition hover:border-cyan-300 hover:bg-cyan-500/10 ${
                  loading || employee ? 'cursor-not-allowed opacity-50' : ''
                }`}
              >
                {key}
              </button>
            ))}
          </div>
        </section>}
      </div>
    </div>
  )
}
