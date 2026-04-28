import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type AireKioskActionResponse, type AireKioskEmployee, type ClockStatus, type TimeCategory } from '../../lib/api'
import { useAuthContext } from '../../contexts/AuthContext'

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
  if (!status?.clocked_in) return 'Not clocked in'
  if (status.status === 'on_break') return 'On break'
  return 'Clocked in'
}

export default function AireKiosk() {
  const { isClerkEnabled, isSignedIn, userRole } = useAuthContext()
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
  const idleResetRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const successResetRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const maskedPin = useMemo(() => (pin.length ? '•'.repeat(pin.length) : '--------'), [pin])

  const selectedCategory = useMemo(
    () => categories.find((category) => category.id === selectedCategoryId) ?? null,
    [categories, selectedCategoryId],
  )
  const kioskAccessToken = !isClerkEnabled ? null : kioskAccessSession?.token ?? null
  const kioskUnlocked = !isClerkEnabled || !!kioskAccessToken
  const canUnlockKiosk = !isClerkEnabled || userRole === 'admin'

  const clearSession = useCallback(() => {
    setPin('')
    setEmployee(null)
    setKioskToken(null)
    setCategories([])
    setSelectedCategoryId(null)
    setStatus(null)
    setLoading(false)
    setActionLoading(null)
    setError(null)
    setSuccess(null)
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

  const handleVerify = async () => {
    if (!kioskUnlocked) {
      setError('Kiosk is locked. Ask an admin to unlock it first.')
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

    setEmployee(result.data.employee)
    setKioskToken(result.data.kiosk_token)
    setStatus(result.data.current_status)
    setCategories(result.data.available_categories)
    setSelectedCategoryId(
      result.data.current_status.time_category?.id ?? result.data.available_categories[0]?.id ?? null,
    )
    setPin('')
    setLoading(false)
  }

  const runAction = async (action: KioskAction) => {
    if (!kioskUnlocked) {
      setError('Kiosk is locked. Ask an admin to unlock it first.')
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

    const result = await request
    if (result.error || !result.data) {
      setError(result.error || `${formatActionLabel(action)} failed.`)
      setActionLoading(null)
      return
    }

    const data = result.data
    applyResponse(data, action === 'switch_category')
    const responseCategory = data.time_entry.time_category
      ? categories.find((category) => category.id === data.time_entry.time_category?.id) ?? selectedCategory
      : selectedCategory
    setSuccess(formatSuccessMessage(action, data.employee, responseCategory))
    setActionLoading(null)
  }

  const handleUnlock = async () => {
    if (!canUnlockKiosk) {
      setError('An admin account is required to unlock this kiosk.')
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

  const canClockIn = !!employee && !status?.clocked_in && status?.can_clock_in !== false && categories.length > 0
  const canClockOut = !!employee && !!status?.clocked_in
  const canStartBreak = !!employee && status?.status === 'clocked_in'
  const canEndBreak = !!employee && status?.status === 'on_break'

  const currentCategoryId = status?.time_category?.id ?? null
  const canSwitchCategory = !!employee && !!status?.clocked_in && categories.length > 1
    && selectedCategoryId !== null && selectedCategoryId !== currentCategoryId

  const primaryActions: Array<{ action: KioskAction; enabled: boolean; className: string }> = [
    ...(canSwitchCategory
      ? [{ action: 'switch_category' as KioskAction, enabled: true, className: 'bg-cyan-400 text-cyan-950 hover:bg-cyan-300' }]
      : [{ action: 'clock_in' as KioskAction, enabled: canClockIn, className: 'bg-emerald-500 text-emerald-950 hover:bg-emerald-400' }]),
    { action: 'clock_out', enabled: canClockOut, className: 'bg-amber-400 text-amber-950 hover:bg-amber-300' },
    { action: 'start_break', enabled: canStartBreak, className: 'bg-indigo-400 text-indigo-950 hover:bg-indigo-300' },
    { action: 'end_break', enabled: canEndBreak, className: 'bg-fuchsia-400 text-fuchsia-950 hover:bg-fuchsia-300' },
  ]

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto flex max-w-6xl items-center justify-end gap-4 px-4 pt-3 text-xs md:px-6">
        <Link to="/admin" className="text-slate-500 transition hover:text-slate-300">Admin</Link>
        <Link to="/" className="text-slate-500 transition hover:text-slate-300">Home</Link>
      </div>
      <div className="mx-auto grid w-full max-w-6xl gap-8 px-4 pb-8 pt-4 md:grid-cols-[1.15fr_1fr] md:px-6">
        <section className="rounded-3xl border border-slate-800 bg-slate-900/60 p-6 md:p-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.13em] text-cyan-300">Aire Staff Kiosk</p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white md:text-4xl">Clock in and out quickly</h1>
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

          <p className="mt-3 max-w-xl text-sm text-slate-300 md:text-base">
            Enter your staff PIN, verify your identity, then clock in or out on this shared kiosk.
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
                    : 'An admin has to unlock this kiosk before staff can enter a PIN.'}
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
                  Admin unlock
                </Link>
              )}
            </div>
          </div>

          <div className="mt-8 rounded-3xl border border-slate-800 bg-slate-950/70 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Current employee</p>
                <p className="mt-1 text-2xl font-semibold text-white">{employee ? employee.full_name : 'Waiting for PIN'}</p>
                <p className="mt-1 text-sm text-cyan-200">{formatStatus(status)}</p>
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

          {!employee ? (
            <div className="mt-8 rounded-2xl border border-slate-800 bg-slate-900/50 px-4 py-4 text-sm text-slate-400">
              {kioskUnlocked ? 'Verify a PIN to get started.' : 'Unlock the kiosk first, then verify a PIN to get started.'}
            </div>
          ) : categories.length > 0 ? (
            <div className="mt-8 space-y-3">
              {status?.clocked_in && categories.length > 1 && (
                <p className="text-xs text-slate-400">Tap a different category to switch your current work type.</p>
              )}
              {categories.map((category) => {
                const selected = selectedCategoryId === category.id
                const isCurrent = currentCategoryId === category.id && status?.clocked_in
                return (
                  <button
                    key={category.id}
                    onClick={() => setSelectedCategoryId(category.id)}
                    className={`flex w-full items-center justify-between rounded-2xl border px-4 py-3 text-left transition ${
                      selected
                        ? 'border-cyan-300 bg-cyan-400/15 text-white'
                        : 'border-slate-700 bg-slate-900/40 text-slate-200 hover:border-slate-500'
                    }`}
                  >
                    <span>
                      <span className="block font-medium">{category.name}</span>
                      {category.description && <span className="mt-1 block text-xs text-slate-400">{category.description}</span>}
                    </span>
                    {isCurrent && (
                      <span className="ml-2 rounded-full bg-cyan-500/20 px-2.5 py-0.5 text-xs font-semibold text-cyan-200">Current</span>
                    )}
                  </button>
                )
              })}
            </div>
          ) : (
            <div className="mt-8 rounded-2xl border border-slate-800 bg-slate-900/50 px-4 py-4 text-sm text-slate-300">
              No work categories assigned. Ask an admin to assign your categories before clocking in.
            </div>
          )}

          <div className="mt-8 grid gap-3 sm:grid-cols-2">
            {primaryActions.map(({ action, enabled, className }) => (
              <button
                key={action}
                onClick={() => runAction(action)}
                disabled={!enabled || !!actionLoading || !!loading}
                className={`rounded-2xl px-5 py-3.5 text-sm font-semibold transition ${className} ${
                  !enabled || actionLoading || loading ? 'cursor-not-allowed opacity-50' : ''
                }`}
              >
                {actionLoading === action ? `${formatActionLabel(action)}...` : formatActionLabel(action)}
              </button>
            ))}
          </div>

          {error && (
            <p className="mt-6 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</p>
          )}

          {success && (
            <p className="mt-6 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">{success}</p>
          )}

          <p className="mt-6 rounded-xl border border-slate-700 bg-slate-900/70 px-4 py-3 text-xs text-slate-300">
            Kiosk sessions auto-reset after inactivity or shortly after a successful action. This keeps the shared device clean and safe.
          </p>
        </section>

        <section className="rounded-3xl border border-slate-800 bg-slate-900 p-6 md:p-8">
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
        </section>
      </div>
    </div>
  )
}
