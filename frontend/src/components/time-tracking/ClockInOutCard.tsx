import { useState, useEffect, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { api } from '../../lib/api'
import type { ClockStatus, TimeCategory } from '../../lib/api'

interface ClockInOutCardProps {
  onStatusChange?: () => void
}

const ENABLE_CLOCK_OUT_DESCRIPTION = false

function Spinner({ className = 'border-white/30 border-t-white' }: { className?: string }) {
  return <span className={`w-5 h-5 border-2 rounded-full animate-spin ${className}`} />
}

export default function ClockInOutCard({ onStatusChange }: ClockInOutCardProps) {
  const [status, setStatus] = useState<ClockStatus | null>(null)
  const [categories, setCategories] = useState<TimeCategory[]>([])
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | ''>('')
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sessionElapsed, setSessionElapsed] = useState(0)
  const [categoryElapsed, setCategoryElapsed] = useState(0)
  const [breakElapsed, setBreakElapsed] = useState(0)
  const [showClockOutModal, setShowClockOutModal] = useState(false)
  const [correctionTime, setCorrectionTime] = useState('')
  const [clockOutDescription, setClockOutDescription] = useState('')
  const timerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined)
  const pollRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined)
  const isOnBreakRef = useRef(false)

  const fetchStatus = useCallback(async () => {
    try {
      const result = await api.getClockStatus()
      if (result.data) {
        setStatus(result.data)
        const session = result.data.session
        if (session?.original_clock_in_at) {
          const sessionStart = new Date(session.original_clock_in_at).getTime()
          setSessionElapsed(Math.floor((Date.now() - sessionStart) / 1000))
        } else if (result.data.clock_in_at) {
          const start = new Date(result.data.clock_in_at).getTime()
          setSessionElapsed(Math.floor((Date.now() - start) / 1000))
        }
        if (result.data.clock_in_at) {
          const catStart = new Date(result.data.clock_in_at).getTime()
          setCategoryElapsed(Math.floor((Date.now() - catStart) / 1000))
        }
        if (result.data.active_break && result.data.active_break_started_at) {
          const breakStart = new Date(result.data.active_break_started_at).getTime()
          setBreakElapsed(Math.floor((Date.now() - breakStart) / 1000))
        }
      }
    } catch {
      setError('Failed to load clock status')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchStatus() }, [fetchStatus])

  useEffect(() => {
    api.getTimeCategories().then((result) => {
      if (result.data?.time_categories) {
        setCategories(result.data.time_categories)
      }
    }).catch(() => undefined)
  }, [])

  // Auto-poll every 60s when not clocked in (waiting for shift to start)
  useEffect(() => {
    if (!status?.clocked_in && !loading) {
      pollRef.current = setInterval(() => fetchStatus(), 60_000)
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [status?.clocked_in, loading, fetchStatus])

  // Keep ref in sync so the single interval callback reads fresh state
  isOnBreakRef.current = status?.active_break ?? false

  // Single interval ticks session, category, and break counters in sync
  useEffect(() => {
    if (status?.clocked_in) {
      timerRef.current = setInterval(() => {
        setSessionElapsed(prev => prev + 1)
        setCategoryElapsed(prev => prev + 1)
        if (isOnBreakRef.current) {
          setBreakElapsed(prev => prev + 1)
        }
      }, 1000)
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [status?.clocked_in])

  // Re-sync with server every 2 minutes while clocked in to prevent drift
  useEffect(() => {
    if (!status?.clocked_in) return
    const syncInterval = setInterval(() => fetchStatus(), 120_000)
    return () => clearInterval(syncInterval)
  }, [status?.clocked_in, fetchStatus])

  // Reset break elapsed when break state changes
  useEffect(() => {
    if (!status?.active_break) {
      setBreakElapsed(0)
    }
  }, [status?.active_break])

  const fmt = (totalSeconds: number) => {
    const h = Math.floor(totalSeconds / 3600)
    const m = Math.floor((totalSeconds % 3600) / 60)
    const s = totalSeconds % 60
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  }

  const fmtTime = (iso: string) => {
    return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
  }

  const fmt12 = (time24: string) => {
    if (!time24) return '—'
    const [h, m] = time24.split(':').map(Number)
    const period = h >= 12 ? 'PM' : 'AM'
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h
    return `${h12}:${m.toString().padStart(2, '0')} ${period}`
  }

  const guamNow = () => {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Pacific/Guam',
      hour: 'numeric', minute: 'numeric', hour12: false,
    }).formatToParts(new Date())
    const h = parseInt(parts.find(p => p.type === 'hour')!.value)
    const m = parseInt(parts.find(p => p.type === 'minute')!.value)
    return { hours: h, minutes: m, totalMin: h * 60 + m }
  }

  const guamHHMM = (date: Date) => {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Pacific/Guam',
      hour: 'numeric', minute: 'numeric', hour12: false,
    }).formatToParts(date)
    const h = parts.find(p => p.type === 'hour')!.value.padStart(2, '0')
    const m = parts.find(p => p.type === 'minute')!.value.padStart(2, '0')
    return `${h}:${m}`
  }

  const isPastSchedule = () => {
    if (!status?.schedule || !status?.clocked_in) return false
    const endParts = status.schedule.end_time.match(/(\d+):(\d+)\s*(AM|PM)/i)
    if (!endParts) return false
    let hours = parseInt(endParts[1])
    const minutes = parseInt(endParts[2])
    const period = endParts[3].toUpperCase()
    if (period === 'PM' && hours !== 12) hours += 12
    if (period === 'AM' && hours === 12) hours = 0
    const schedEnd = hours * 60 + minutes
    const { totalMin: currentMin } = guamNow()
    return currentMin > schedEnd + 30
  }

  const correctionBeforeClockIn = (() => {
    if (!correctionTime || !status?.clock_in_at) return false
    const clockInHHMM = guamHHMM(new Date(status.clock_in_at))
    return correctionTime <= clockInHHMM
  })()

  const handleClockOut = () => {
    const pastSchedule = isPastSchedule()
    if (pastSchedule) {
      const { hours: h, minutes: m } = guamNow()
      const hh = h.toString().padStart(2, '0')
      const mm = m.toString().padStart(2, '0')
      setCorrectionTime(`${hh}:${mm}`)
    } else {
      setCorrectionTime('')
      void handleClockOutSubmit()
      return
    }
    setClockOutDescription('')
    setShowClockOutModal(true)
  }

  const handleClockOutSubmit = async () => {
    setShowClockOutModal(false)
    setActionLoading(true)
    setError(null)
    try {
      const correctedEnd = correctionTime ? (() => {
        const guamDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Guam', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
        return `${guamDate}T${correctionTime}:00`
      })() : undefined
      const desc = ENABLE_CLOCK_OUT_DESCRIPTION ? clockOutDescription.trim() || undefined : undefined
      const result = await api.clockOut(correctedEnd, desc)
      if (result?.error) {
        setError(result.error)
        await fetchStatus()
      } else {
        await fetchStatus()
        onStatusChange?.()
      }
    } catch {
      setError('Action failed. Please try again.')
      await fetchStatus()
    } finally {
      setActionLoading(false)
    }
  }

  const handleAction = async (action: 'clock_in' | 'start_break' | 'end_break', adminOverride = false) => {
    if (action === 'clock_in' && categories.length > 0 && !selectedCategoryId) {
      setError('Choose a work category before clocking in.')
      return
    }

    setActionLoading(true)
    setError(null)
    try {
      const fn = {
        clock_in: () => api.clockIn(undefined, adminOverride, Number(selectedCategoryId)),
        start_break: () => api.startBreak(),
        end_break: () => api.endBreak(),
      }
      const result = await fn[action]()
      if (action === 'end_break') setBreakElapsed(0)
      if (result?.error) {
        setError(result.error)
        await fetchStatus()
      } else {
        await fetchStatus()
        onStatusChange?.()
      }
    } catch {
      setError('Action failed. Please try again.')
      await fetchStatus()
    } finally {
      setActionLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="bg-white rounded-2xl shadow-sm border border-neutral-warm p-5 animate-pulse">
        <div className="md:flex md:items-center md:gap-8">
          <div className="h-5 bg-neutral-warm rounded w-28 mb-4 md:mb-0" />
          <div className="h-10 bg-neutral-warm/60 rounded-xl flex-1" />
        </div>
      </div>
    )
  }

  const isClockedIn = status?.clocked_in
  const isOnBreak = status?.status === 'on_break'
  const isAdmin = status?.is_admin ?? false
  const blockedReason = status?.clock_in_blocked_reason
  const isAdminOverridable = isAdmin && (blockedReason === 'too_early' || blockedReason === 'shift_ended')
  const canClockIn = status?.can_clock_in || isAdminOverridable

  const hasMultipleSegments = (status?.session?.segments?.length ?? 0) > 1
  const sessionBreakMin = status?.session?.total_break_minutes ?? (status?.break_minutes || 0)
  const netSessionWorkSeconds = isClockedIn ? sessionElapsed - sessionBreakMin * 60 - (isOnBreak ? breakElapsed : 0) : 0
  const netCategoryWorkSeconds = isClockedIn ? categoryElapsed - (status?.break_minutes || 0) * 60 - (isOnBreak ? breakElapsed : 0) : 0
  const activeCategoryLabel = status?.time_category?.name ?? 'General'

  const stripeColor = isOnBreak ? 'bg-amber-400' : isClockedIn ? 'bg-emerald-500' : 'bg-neutral-warm'
  const borderColor = isOnBreak ? 'border-amber-300/60' : isClockedIn ? 'border-emerald-300/60' : 'border-neutral-warm'
  const dotColor = isOnBreak ? 'bg-amber-400 animate-pulse' : isClockedIn ? 'bg-emerald-500 animate-pulse' : 'bg-neutral-warm'
  const statusLabel = isOnBreak ? 'On Break' : isClockedIn ? 'Clocked In' : 'Not Clocked In'
  const selectedCategory = categories.find((category) => category.id === selectedCategoryId) || null

  // Shared button styles
  const btnPrimary = 'min-h-[48px] py-3 px-5 bg-primary hover:bg-primary-dark active:bg-primary-dark disabled:bg-neutral-warm disabled:text-text-muted text-white font-semibold rounded-xl transition-colors flex items-center justify-center gap-2 text-sm shadow-sm'
  const btnSecondary = 'min-h-[48px] py-3 px-5 bg-secondary-dark hover:bg-neutral-warm active:bg-neutral-warm text-primary-dark font-semibold rounded-xl transition-colors flex items-center justify-center gap-2 text-sm border border-neutral-warm'
  const btnBreak = 'min-h-[48px] py-3 px-5 bg-amber-500 hover:bg-amber-600 active:bg-amber-700 disabled:opacity-50 text-white font-semibold rounded-xl transition-colors flex items-center justify-center gap-2 text-sm shadow-sm'

  return (
    <div className={`rounded-2xl border shadow-sm transition-all duration-300 hover:shadow-md overflow-hidden bg-white ${borderColor}`}>
      <div className={`h-1 ${stripeColor}`} />

      {/* ─── Mobile / Tablet layout (stacked) ─── */}
      <div className="p-5 md:hidden">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${dotColor}`} />
            <h3 className="font-semibold text-primary-dark text-base">{statusLabel}</h3>
          </div>
          {status?.schedule && !isClockedIn && (
            <span className="text-xs text-text-muted bg-secondary rounded-full px-2.5 py-1">
              {status.schedule.start_time} – {status.schedule.end_time}
            </span>
          )}
        </div>

        {/* Timer (mobile) */}
        {isClockedIn && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="mb-5">
            <div className={`text-center py-3 rounded-xl ${isOnBreak ? 'bg-amber-50 border border-amber-200/60' : 'bg-secondary/60'}`}>
              <div className={`font-mono text-3xl font-bold tabular-nums tracking-tight ${isOnBreak ? 'text-amber-600' : 'text-primary-dark'}`}>
                {isOnBreak ? fmt(breakElapsed) : fmt(Math.max(netSessionWorkSeconds, 0))}
              </div>
              <div className={`text-[10px] mt-1 font-medium uppercase tracking-wider ${isOnBreak ? 'text-amber-500' : 'text-text-muted'}`}>
                {isOnBreak ? 'Break time' : 'Time worked'}
              </div>
            </div>
            <div className={`grid gap-2.5 mt-3 ${hasMultipleSegments ? 'grid-cols-3' : 'grid-cols-2'}`}>
              <div className="text-center bg-secondary/40 rounded-xl py-2 px-2">
                <div className="text-sm font-semibold text-primary-dark tabular-nums font-mono">
                  {fmt(sessionElapsed)}
                </div>
                <div className="text-[10px] text-text-muted font-medium uppercase tracking-wider mt-0.5">
                  Total time
                </div>
              </div>
              {hasMultipleSegments && (
                <div className="text-center bg-secondary/40 rounded-xl py-2 px-2">
                  <div className="text-sm font-semibold text-cyan-700 tabular-nums font-mono">
                    {fmt(Math.max(netCategoryWorkSeconds, 0))}
                  </div>
                  <div className="text-[10px] text-text-muted font-medium uppercase tracking-wider mt-0.5">
                    This category
                  </div>
                </div>
              )}
              <div className="text-center bg-secondary/40 rounded-xl py-2 px-2">
                <div className="text-sm font-semibold tabular-nums font-mono text-text-muted">
                  {isOnBreak ? fmt(Math.max(netSessionWorkSeconds, 0)) : `${sessionBreakMin}m`}
                </div>
                <div className="text-[10px] text-text-muted font-medium uppercase tracking-wider mt-0.5">
                  {isOnBreak ? 'Time worked' : 'Breaks'}
                </div>
              </div>
            </div>
          </motion.div>
        )}

        {/* Timeline (mobile) */}
        {isClockedIn && status?.clock_in_at && (
          <>
            {hasMultipleSegments && status.session && (
              <SessionSegments segments={status.session.segments} fmtTime={fmtTime} />
            )}
            {!hasMultipleSegments && (
              <TimelineSection clockInAt={status.session?.original_clock_in_at || status.clock_in_at} breaks={status.breaks || []} fmtTime={fmtTime} />
            )}
          </>
        )}

        {/* Schedule / no-schedule (mobile) */}
        {!isClockedIn && status?.schedule && (
          <div className="mb-4 p-3.5 bg-secondary/60 rounded-xl border border-neutral-warm/50">
            <div className="text-xs font-medium text-text-muted uppercase tracking-wider">Today's Shift</div>
            <div className="text-lg font-semibold text-primary-dark mt-1">{status.schedule.start_time} – {status.schedule.end_time}</div>
            <div className="text-xs text-text-muted mt-0.5">{status.schedule.hours} hours</div>
          </div>
        )}
        {!isClockedIn && !status?.schedule && <NoScheduleMsg />}
        {!isClockedIn && blockedReason === 'too_early' && <TooEarlyMsg isAdmin={isAdmin} minutesUntil={status?.minutes_until} />}
        {!isClockedIn && blockedReason === 'shift_ended' && <ShiftEndedMsg isAdmin={isAdmin} />}

        {!isClockedIn && categories.length > 0 && (
          <div className="mb-4 p-3.5 bg-secondary/40 rounded-xl border border-neutral-warm/50">
            <label className="block text-xs font-medium text-text-muted uppercase tracking-wider mb-2">Work Category</label>
            <select
              value={selectedCategoryId}
              onChange={(e) => setSelectedCategoryId(e.target.value ? Number(e.target.value) : '')}
              className="w-full px-3 py-2.5 bg-white border border-neutral-warm rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
            >
              <option value="">Select a category</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>{category.name}</option>
              ))}
            </select>
          </div>
        )}
        {!isClockedIn && categories.length === 0 && (
          <div className="mb-4 p-3.5 bg-secondary/40 rounded-xl border border-neutral-warm/50">
            <div className="text-sm text-text-muted">
              No work categories are assigned. Your time will be tracked under <span className="font-semibold text-primary-dark">General</span>.
            </div>
          </div>
        )}

        {isClockedIn && (
          <div className="mb-4 p-3.5 bg-secondary/40 rounded-xl border border-neutral-warm/50">
            <div className="text-sm text-text-muted">
              Current work category: <span className="font-semibold text-primary-dark">{activeCategoryLabel}</span>
            </div>
            {categories.length > 1 && (
              <SwitchCategoryInline
                categories={categories}
                currentCategoryId={status?.time_category?.id ?? null}
                onSwitch={async (catId) => {
                  setActionLoading(true)
                  setError(null)
                  try {
                    const result = await api.switchCategory(catId)
                    if (result?.error) { setError(result.error) } else { await fetchStatus(); onStatusChange?.() }
                  } catch { setError('Switch failed.') }
                  finally { setActionLoading(false) }
                }}
                disabled={actionLoading}
              />
            )}
          </div>
        )}

        <ErrorMsg error={error} />

        {/* Buttons (mobile - stacked) */}
        <div className="space-y-2">
          {!isClockedIn ? (
            <button
              onClick={() => handleAction('clock_in', isAdminOverridable)}
              disabled={actionLoading || !canClockIn}
              className={`w-full ${btnPrimary}`}
            >
              {actionLoading ? <Spinner /> : <><ClockIcon /> {isAdminOverridable ? 'Clock In (Override)' : 'Clock In'}</>}
            </button>
          ) : (
            <>
              {isOnBreak ? (
                <button onClick={() => handleAction('end_break')} disabled={actionLoading} className={`w-full ${btnBreak}`}>
                  {actionLoading ? <Spinner /> : <><PlayIcon /> End Break</>}
                </button>
              ) : (
                <button onClick={() => handleAction('start_break')} disabled={actionLoading} className={`w-full ${btnSecondary}`}>
                  {actionLoading ? <Spinner className="border-primary-dark/30 border-t-primary-dark" /> : <><PauseIcon /> Start Break</>}
                </button>
              )}
              <button onClick={handleClockOut} disabled={actionLoading} className={`w-full ${btnPrimary}`}>
                {actionLoading ? <Spinner /> : <><StopIcon /> Clock Out</>}
              </button>
            </>
          )}
        </div>
      </div>

      {/* ─── Desktop layout ─── */}
      <div className="hidden md:block p-5">
        {/* Top row: status + buttons */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className={`w-3 h-3 rounded-full shrink-0 ${dotColor}`} />
            <div>
              <h3 className="font-semibold text-primary-dark text-base leading-tight">{statusLabel}</h3>
              {status?.schedule && (
                <span className="text-xs text-text-muted">
                  Shift: {status.schedule.start_time} – {status.schedule.end_time} ({status.schedule.hours}h)
                </span>
              )}
              {!status?.schedule && !isClockedIn && (
                <span className="text-xs text-text-muted">No shift scheduled today</span>
              )}
              {isClockedIn && (
                <div className="text-xs text-text-muted mt-1">
                  Category: <span className="font-medium text-primary-dark">{activeCategoryLabel}</span>
                </div>
              )}
            </div>
          </div>

          {!isClockedIn && blockedReason && blockedReason !== 'already_clocked_in' && (
            <div className="flex-1 text-center">
              <span className="text-xs text-amber-600 font-medium">
                {blockedReason === 'too_early' && (status?.minutes_until != null ? `Clock in available in ~${status.minutes_until}m` : 'Shift hasn\'t started yet')}
                {blockedReason === 'shift_ended' && 'Shift has ended'}
                {isAdmin && ' — admin override available'}
              </span>
            </div>
          )}

          {!isClockedIn && !blockedReason && <div className="flex-1" />}

          <div className="flex items-center gap-2 shrink-0">
            {!isClockedIn ? (
              <button
                onClick={() => handleAction('clock_in', isAdminOverridable)}
                disabled={actionLoading || !canClockIn}
                className={btnPrimary}
              >
                {actionLoading ? <Spinner /> : <><ClockIcon /> {isAdminOverridable ? 'Clock In (Override)' : 'Clock In'}</>}
              </button>
            ) : (
              <>
                {isOnBreak ? (
                  <button onClick={() => handleAction('end_break')} disabled={actionLoading} className={btnBreak}>
                    {actionLoading ? <Spinner /> : <><PlayIcon /> End Break</>}
                  </button>
                ) : (
                  <button onClick={() => handleAction('start_break')} disabled={actionLoading} className={btnSecondary}>
                    {actionLoading ? <Spinner className="border-primary-dark/30 border-t-primary-dark" /> : <><PauseIcon /> Start Break</>}
                  </button>
                )}
                <button onClick={handleClockOut} disabled={actionLoading} className={btnPrimary}>
                  {actionLoading ? <Spinner /> : <><StopIcon /> Clock Out</>}
                </button>
              </>
            )}
          </div>
        </div>

        {/* Timer row (only when clocked in) */}
        {isClockedIn && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-4 pt-4 border-t border-neutral-warm/50"
          >
            <div className="flex items-center gap-6 lg:gap-8">
              <div className="text-center">
                <div className={`font-mono text-3xl lg:text-4xl font-bold tabular-nums tracking-tight ${isOnBreak ? 'text-amber-600' : 'text-primary-dark'}`}>
                  {isOnBreak ? fmt(breakElapsed) : fmt(Math.max(netSessionWorkSeconds, 0))}
                </div>
                <div className={`text-[10px] font-medium uppercase tracking-wider mt-1 ${isOnBreak ? 'text-amber-500' : 'text-text-muted'}`}>
                  {isOnBreak ? 'Break time' : 'Time worked'}
                </div>
              </div>
              <div className="w-px h-12 bg-neutral-warm/60" />
              <div className="text-center">
                <div className="font-mono text-xl lg:text-2xl font-semibold text-primary-dark tabular-nums">
                  {fmt(sessionElapsed)}
                </div>
                <div className="text-[10px] text-text-muted font-medium uppercase tracking-wider mt-1">
                  Total time
                </div>
              </div>
              {hasMultipleSegments && (
                <>
                  <div className="w-px h-12 bg-neutral-warm/60" />
                  <div className="text-center">
                    <div className="font-mono text-xl lg:text-2xl font-semibold text-cyan-700 tabular-nums">
                      {fmt(Math.max(netCategoryWorkSeconds, 0))}
                    </div>
                    <div className="text-[10px] text-text-muted font-medium uppercase tracking-wider mt-1">
                      This category
                    </div>
                  </div>
                </>
              )}
              <div className="w-px h-12 bg-neutral-warm/60" />
              <div className="text-center">
                <div className="font-mono text-xl lg:text-2xl font-semibold tabular-nums text-text-muted">
                  {isOnBreak ? fmt(Math.max(netSessionWorkSeconds, 0)) : `${sessionBreakMin}m`}
                </div>
                <div className="text-[10px] text-text-muted font-medium uppercase tracking-wider mt-1">
                  {isOnBreak ? 'Time worked' : 'Breaks'}
                </div>
              </div>
            </div>
          </motion.div>
        )}

        {!isClockedIn && categories.length > 0 && (
          <div className="mt-4 pt-4 border-t border-neutral-warm/50 max-w-sm">
            <label className="block text-xs font-medium text-text-muted uppercase tracking-wider mb-2">Work Category</label>
            <select
              value={selectedCategoryId}
              onChange={(e) => setSelectedCategoryId(e.target.value ? Number(e.target.value) : '')}
              className="w-full px-3 py-2.5 bg-secondary/50 border border-neutral-warm rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
            >
              <option value="">Select a category</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>{category.name}</option>
              ))}
            </select>
            {selectedCategory && (
              <p className="mt-2 text-xs text-text-muted">Selected: <span className="font-medium text-primary-dark">{selectedCategory.name}</span></p>
            )}
          </div>
        )}
        {!isClockedIn && categories.length === 0 && (
          <div className="mt-4 pt-4 border-t border-neutral-warm/50 max-w-xl">
            <p className="text-sm text-text-muted">
              No work categories are assigned. Your time will be tracked under <span className="font-semibold text-primary-dark">General</span>.
            </p>
          </div>
        )}

        {isClockedIn && categories.length > 1 && (
          <div className="mt-3 pt-3 border-t border-neutral-warm/50 max-w-sm">
            <SwitchCategoryInline
              categories={categories}
              currentCategoryId={status?.time_category?.id ?? null}
              onSwitch={async (catId) => {
                setActionLoading(true)
                setError(null)
                try {
                  const result = await api.switchCategory(catId)
                  if (result?.error) { setError(result.error) } else { await fetchStatus(); onStatusChange?.() }
                } catch { setError('Switch failed.') }
                finally { setActionLoading(false) }
              }}
              disabled={actionLoading}
            />
          </div>
        )}

        <ErrorMsg error={error} />

        {isClockedIn && status?.clock_in_at && (
          <>
            {hasMultipleSegments && status.session && (
              <SessionSegments segments={status.session.segments} fmtTime={fmtTime} compact />
            )}
            {!hasMultipleSegments && (
              <TimelineSection clockInAt={status.session?.original_clock_in_at || status.clock_in_at} breaks={status.breaks || []} fmtTime={fmtTime} compact />
            )}
          </>
        )}
      </div>

      {/* Clock-out modal: description + optional time correction */}
      {showClockOutModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setShowClockOutModal(false)}>
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-start gap-3 mb-5">
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                <svg className="w-5 h-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
                </svg>
              </div>
              <div>
                <h3 className="font-semibold text-gray-900">Clock Out</h3>
                <p className="text-sm text-gray-500 mt-0.5">
                  {(status?.session?.original_clock_in_at || status?.clock_in_at) && `You've been working since ${fmtTime(status?.session?.original_clock_in_at || status!.clock_in_at!)}`}
                </p>
              </div>
            </div>

            <div className="space-y-4">
              {ENABLE_CLOCK_OUT_DESCRIPTION && (
                <div>
                  <label className="text-sm font-medium text-gray-700 block mb-1.5">
                    What did you work on today?
                  </label>
                  <textarea
                    value={clockOutDescription}
                    onChange={e => setClockOutDescription(e.target.value)}
                    placeholder="e.g. Flight instruction with student, ground school briefing, aircraft preflight..."
                    rows={3}
                    className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-primary/30 focus:border-primary resize-none placeholder:text-gray-400"
                    autoFocus
                  />
                  <p className="text-xs text-gray-400 mt-1">Optional, but helps keep track of your day</p>
                </div>
              )}

              {correctionTime && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                  <div className="flex items-start gap-2 mb-3">
                    <svg className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <div>
                      <p className="text-sm font-medium text-amber-700">Past scheduled shift end</p>
                      <p className="text-xs text-amber-600 mt-0.5">
                        Your shift was scheduled to end at {status?.schedule?.end_time}. What time did you actually stop?
                      </p>
                    </div>
                  </div>
                  <input
                    type="time"
                    value={correctionTime}
                    onChange={e => setCorrectionTime(e.target.value)}
                    className={`w-full border rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-primary/30 focus:border-primary bg-white ${
                      correctionBeforeClockIn ? 'border-red-300 bg-red-50' : 'border-amber-300'
                    }`}
                  />
                  {correctionBeforeClockIn && (
                    <p className="text-xs text-red-500 mt-1.5">Time must be after your clock-in ({fmtTime(status!.clock_in_at!)})</p>
                  )}
                  <div className="flex items-center gap-2 mt-2">
                    <button
                      onClick={() => setCorrectionTime('')}
                      className="text-xs text-amber-700 hover:text-amber-900 font-medium hover:underline"
                    >
                      I worked until now instead
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="flex gap-2 mt-5">
              <button
                onClick={handleClockOutSubmit}
                disabled={correctionTime !== '' && (!correctionTime || correctionBeforeClockIn)}
                className="flex-1 min-h-[44px] bg-primary text-white font-semibold rounded-xl text-sm hover:bg-primary-dark disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
              >
                <StopIcon />
                {correctionTime ? `Clock Out at ${fmt12(correctionTime)}` : 'Clock Out'}
              </button>
              <button
                onClick={() => setShowClockOutModal(false)}
                className="min-h-[44px] px-5 border border-gray-300 text-gray-700 font-semibold rounded-xl text-sm hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function TimelineSection({ clockInAt, breaks, fmtTime, compact }: {
  clockInAt: string
  breaks: Array<{ start_time: string; end_time: string | null; duration_minutes: number | null; active: boolean }>
  fmtTime: (iso: string) => string
  compact?: boolean
}) {
  if (!breaks.length && !compact) {
    return (
      <div className="mb-4 text-xs text-text-muted bg-secondary/40 rounded-lg px-3 py-2">
        Clocked in at <span className="font-medium text-primary-dark">{fmtTime(clockInAt)}</span>
      </div>
    )
  }

  return (
    <div className={compact ? 'mt-3 pt-3 border-t border-neutral-warm/50' : 'mb-4'}>
      <div className={`flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-muted ${compact ? '' : 'bg-secondary/40 rounded-lg px-3 py-2'}`}>
        <span>
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 mr-1 align-middle" />
          In <span className="font-medium text-primary-dark">{fmtTime(clockInAt)}</span>
        </span>
        {breaks.map((b, i) => (
          <span key={i} className="flex items-center gap-1">
            <span className="text-neutral-warm">→</span>
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400 mr-0.5 align-middle" />
            Break {fmtTime(b.start_time)}
            {b.end_time ? (
              <>
                <span className="text-neutral-warm">–</span>
                {fmtTime(b.end_time)}
                <span className="text-text-muted">({b.duration_minutes}m)</span>
              </>
            ) : (
              <span className="text-amber-600 font-medium">(active)</span>
            )}
          </span>
        ))}
      </div>
    </div>
  )
}

function SessionSegments({ segments, fmtTime, compact }: {
  segments: Array<{ category_name: string; clock_in_at: string; clock_out_at: string | null; active: boolean }>
  fmtTime: (iso: string) => string
  compact?: boolean
}) {
  return (
    <div className={compact ? 'mt-3 pt-3 border-t border-neutral-warm/50' : 'mb-4'}>
      <div className={compact ? '' : 'bg-secondary/40 rounded-lg px-3 py-2'}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-muted">
          {segments.map((seg, i) => (
            <span key={i} className="flex items-center gap-1">
              {i > 0 && <span className="text-neutral-warm">→</span>}
              <span className={`inline-block w-1.5 h-1.5 rounded-full ${seg.active ? 'bg-emerald-500 animate-pulse' : 'bg-cyan-400'} mr-0.5 align-middle`} />
              <span className="font-medium text-primary-dark">{seg.category_name}</span>
              <span>{fmtTime(seg.clock_in_at)}</span>
              {seg.clock_out_at && (
                <>
                  <span className="text-neutral-warm">–</span>
                  <span>{fmtTime(seg.clock_out_at)}</span>
                </>
              )}
              {seg.active && <span className="text-emerald-600 font-medium">(now)</span>}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

function ErrorMsg({ error }: { error: string | null }) {
  return (
    <AnimatePresence>
      {error && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          className="mt-3 p-3 bg-red-50 border border-red-100 rounded-xl text-sm text-red-600"
        >
          {error}
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function NoScheduleMsg() {
  return (
    <div className="mb-4 p-3 bg-slate-50 rounded-xl border border-slate-200">
      <div className="flex items-start gap-2">
        <svg className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
        <div className="text-xs text-slate-500">No shift scheduled today — you can still clock in.</div>
      </div>
    </div>
  )
}

function ShiftEndedMsg({ isAdmin }: { isAdmin: boolean }) {
  return (
    <div className="mb-4 p-3.5 bg-amber-50 rounded-xl border border-amber-200">
      <div className="flex items-start gap-2">
        <svg className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <div>
          <div className="text-sm font-medium text-amber-700">Shift has ended</div>
          <div className="text-xs text-amber-600 mt-0.5">
            {isAdmin
              ? 'Your shift has ended, but you can use admin override.'
              : 'Your shift has ended. Please submit a manual entry if you need to log time.'}
          </div>
        </div>
      </div>
    </div>
  )
}

function TooEarlyMsg({ isAdmin, minutesUntil }: { isAdmin: boolean; minutesUntil?: number }) {
  return (
    <div className="mb-4 p-3.5 bg-amber-50 rounded-xl border border-amber-200">
      <div className="flex items-start gap-2">
        <svg className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <div>
          <div className="text-sm font-medium text-amber-700">Too early to clock in</div>
          <div className="text-xs text-amber-600 mt-0.5">
            {isAdmin
              ? 'Your shift hasn\'t started yet, but you can use admin override.'
              : `You can clock in ${minutesUntil != null ? `in ~${minutesUntil} minutes` : 'shortly before your shift'}. This will update automatically.`}
          </div>
        </div>
      </div>
    </div>
  )
}

function ClockIcon() {
  return (
    <svg className="w-4.5 h-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  )
}

function PauseIcon() {
  return (
    <svg className="w-4.5 h-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  )
}

function PlayIcon() {
  return (
    <svg className="w-4.5 h-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  )
}

function StopIcon() {
  return (
    <svg className="w-4.5 h-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
    </svg>
  )
}

function SwitchCategoryInline({
  categories,
  currentCategoryId,
  onSwitch,
  disabled,
}: {
  categories: TimeCategory[]
  currentCategoryId: number | null
  onSwitch: (categoryId: number) => void
  disabled: boolean
}) {
  const [switchTo, setSwitchTo] = useState<string>('')

  return (
    <div className="flex items-center gap-2 mt-2">
      <select
        value={switchTo}
        onChange={e => setSwitchTo(e.target.value)}
        className="text-sm border border-neutral-warm rounded-xl px-3 py-2 bg-white text-primary-dark flex-1 focus:outline-none focus:ring-2 focus:ring-primary/20"
      >
        <option value="">Switch category...</option>
        {categories.filter(c => c.id !== currentCategoryId).map(c => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
      </select>
      <button
        disabled={disabled || !switchTo}
        onClick={() => { onSwitch(Number(switchTo)); setSwitchTo('') }}
        className="text-xs font-semibold bg-cyan-50 text-cyan-700 border border-cyan-300 rounded-xl px-3 py-2 hover:bg-cyan-100 disabled:opacity-50 transition-colors whitespace-nowrap"
      >
        Switch
      </button>
    </div>
  )
}
