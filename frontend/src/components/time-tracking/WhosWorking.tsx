import { useState, useEffect, useCallback, useRef, type JSX } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { api, getAuthTokenValue } from '../../lib/api'
import type { WorkerStatus, WorkerBreak, WorkerDayEntry, TimeCategory } from '../../lib/api'
import { getOrCreateConsumer, disconnectConsumer, type Subscription } from '../../lib/cable'

interface WhosWorkingProps {
  alwaysShow?: boolean
  dashboardStyle?: boolean
}

const POLL_INTERVAL_MS = 30_000

export default function WhosWorking({ alwaysShow = false, dashboardStyle = false }: WhosWorkingProps) {
  const [workers, setWorkers] = useState<WorkerStatus[]>([])
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [cableConnected, setCableConnected] = useState(false)
  const [categories, setCategories] = useState<TimeCategory[]>([])
  const pollRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined)
  const subscriptionRef = useRef<Subscription | null>(null)

  const fetchWorkers = useCallback(async () => {
    try {
      const result = await api.getWhosWorking()
      if (result.data) {
        setWorkers(result.data.workers)
        setFetchError(false)
      }
    } catch {
      setFetchError(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchWorkers()
    api.getTimeCategories().then(r => {
      if (r.data) setCategories(r.data.time_categories)
    })

    let mounted = true

    let reconnectTimer: ReturnType<typeof setTimeout> | undefined

    async function setupCable() {
      try {
        const consumer = await getOrCreateConsumer(getAuthTokenValue)
        if (!consumer || !mounted) return

        subscriptionRef.current = consumer.subscriptions.create(
          { channel: 'TimeClockChannel' },
          {
            connected() {
              if (mounted) setCableConnected(true)
            },
            disconnected() {
              if (mounted) {
                setCableConnected(false)
                reconnectTimer = setTimeout(() => {
                  if (mounted) setupCable()
                }, 3000)
              }
            },
            received(data: { type: string }) {
              if (data.type === 'time_clock_update' && mounted) {
                fetchWorkers()
              }
            },
          },
        )
      } catch {
        // Cable connection failed — polling fallback handles it
      }
    }

    setupCable()

    pollRef.current = setInterval(fetchWorkers, POLL_INTERVAL_MS)

    return () => {
      mounted = false
      if (reconnectTimer) clearTimeout(reconnectTimer)
      if (pollRef.current) clearInterval(pollRef.current)
      if (subscriptionRef.current) {
        subscriptionRef.current.unsubscribe()
        subscriptionRef.current = null
      }
      disconnectConsumer()
    }
  }, [fetchWorkers])

  const cardBorder = dashboardStyle ? 'border-secondary-dark' : 'border-neutral-warm'
  const cardClass = `bg-white rounded-2xl shadow-sm border ${cardBorder} overflow-hidden hover:shadow-md transition-shadow duration-300 ${dashboardStyle ? 'h-full w-full flex flex-col' : ''}`

  if (loading) {
    return (
      <div className={`${cardClass} animate-pulse`}>
        {!dashboardStyle && <div className="h-1 bg-neutral-warm" />}
        <div className="p-5 flex-1">
          <div className="h-5 bg-neutral-warm rounded w-32 mb-4" />
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-10 bg-neutral-warm/60 rounded-xl" />
            ))}
          </div>
        </div>
      </div>
    )
  }

  if (fetchError && workers.length === 0) {
    return (
      <div className={cardClass}>
        {!dashboardStyle && <div className="h-1 bg-neutral-warm" />}
        <div className="p-5 flex-1">
          <h3 className="font-semibold text-primary-dark text-base mb-3">Today's Team</h3>
          <div className="text-center py-4">
            <p className="text-sm text-red-600 mb-2">Unable to load team status</p>
            <button onClick={fetchWorkers} className="text-xs text-primary-dark hover:underline font-medium">
              Retry
            </button>
          </div>
        </div>
      </div>
    )
  }

  const activeWorkers = workers.filter(w => w.status === 'clocked_in' || w.status === 'on_break')
  const relevantWorkers = showAll
    ? workers
    : workers.filter(w => w.schedule || w.status === 'clocked_in' || w.status === 'on_break' || w.status === 'clocked_out')
  const hiddenCount = workers.length - relevantWorkers.length

  if (relevantWorkers.length === 0 && !showAll) {
    if (!alwaysShow) return null
    return (
      <div className={cardClass}>
        {!dashboardStyle && <div className="h-1 bg-neutral-warm" />}
        <div className="p-5 flex-1 flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-primary-dark text-base">Today's Team</h3>
            <div className="flex items-center gap-1.5 bg-secondary rounded-full px-2.5 py-1">
              <div className="w-2 h-2 rounded-full bg-neutral-warm" />
              <span className="text-xs text-text-muted font-medium">0 active</span>
            </div>
          </div>
          <div className="text-center py-6 flex-1 flex flex-col items-center justify-center">
            <div className="w-10 h-10 bg-secondary rounded-full flex items-center justify-center mx-auto mb-2">
              <svg className="w-5 h-5 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
            </div>
            <p className="text-sm text-text-muted">No one is working or scheduled today</p>
          </div>
        </div>
      </div>
    )
  }

  const statusConfig: Record<string, { label: string; color: string; dot: string }> = {
    clocked_in: { label: 'Working', color: 'text-emerald-600', dot: 'bg-emerald-500' },
    on_break: { label: 'On Break', color: 'text-amber-600', dot: 'bg-amber-400' },
    clocked_out: { label: 'Done', color: 'text-blue-600', dot: 'bg-blue-400' },
    late: { label: 'Late', color: 'text-red-500', dot: 'bg-red-400' },
    no_show: { label: 'No Show', color: 'text-red-700', dot: 'bg-red-600' },
    not_clocked_in: { label: 'Not In', color: 'text-text-muted', dot: 'bg-neutral-warm' },
    no_schedule: { label: 'Off', color: 'text-text-muted/50', dot: 'bg-neutral-warm/60' },
  }

  const fmtTime = (iso: string) =>
    new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })

  const sourceLabel = (source?: string | null) =>
    ({ kiosk: 'Kiosk', mobile: 'Mobile', admin: 'Admin', legacy: 'Legacy' }[source || ''] || '—')

  const isExpandable = () => true

  return (
    <div className={cardClass}>
      {!dashboardStyle && <div className="h-1 bg-neutral-warm" />}
      <div className="p-5 flex-1">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-primary-dark text-base">Today's Team</h3>
            {cableConnected && (
              <span className="flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Live
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={fetchWorkers}
              className="text-xs text-text-muted hover:text-primary-dark font-medium transition-colors"
              title="Refresh snapshot"
            >
              Refresh snapshot
            </button>
            <div className="flex items-center gap-1.5 bg-secondary rounded-full px-2.5 py-1">
              <div className="w-2 h-2 rounded-full bg-emerald-500" />
              <span className="text-xs text-text-muted font-medium">{activeWorkers.length} active</span>
            </div>
          </div>
        </div>

        <div className="space-y-1">
          <AnimatePresence initial={false}>
            {relevantWorkers.map(worker => {
              const config = statusConfig[worker.status] || statusConfig.no_schedule
              const canExpand = isExpandable()
              const isExpanded = expandedId === worker.user.id && canExpand

              return (
                <motion.div
                  key={worker.user.id}
                  layout
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.2 }}
                >
                  <div
                    className={`py-2.5 px-3 rounded-xl transition-colors ${
                      canExpand
                        ? 'bg-secondary/50 cursor-pointer hover:bg-secondary/70'
                        : 'hover:bg-secondary/30'
                    }`}
                    onClick={() => canExpand && setExpandedId(isExpanded ? null : worker.user.id)}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={`w-2 h-2 rounded-full shrink-0 ${config.dot} ${
                          (worker.status === 'clocked_in' || worker.status === 'on_break') ? 'animate-pulse' : ''
                        }`} />
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-primary-dark truncate">
                            {worker.user.full_name || worker.user.display_name}
                          </div>
                          {worker.schedule && !canExpand && (
                            <div className="text-[11px] text-text-muted">
                              {worker.schedule.start_time} – {worker.schedule.end_time}
                            </div>
                          )}
                          {(worker.status === 'clocked_in' || worker.status === 'on_break') && (
                            <div className="text-[11px] text-text-muted">
                              In since {worker.clock_in_at ? fmtTime(worker.clock_in_at) : '—'}
                              {worker.time_category?.name && <span className="ml-1">· {worker.time_category.name}</span>}
                              {worker.active_break && (
                                <span className="text-amber-600 font-medium ml-1">· On break</span>
                              )}
                            </div>
                          )}
                          {worker.status === 'clocked_out' && (
                            <div className="text-[11px] text-text-muted">
                              {worker.clock_in_at && worker.clock_out_at
                                ? `${fmtTime(worker.clock_in_at)} – ${fmtTime(worker.clock_out_at)}`
                                : 'Completed today'}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="text-right shrink-0 ml-3 flex items-center gap-2">
                        <div>
                          <div className={`text-xs font-semibold ${config.color}`}>
                            {config.label}
                          </div>
                          {worker.completed_hours > 0 && (
                            <div className="text-[11px] text-text-muted">
                              {worker.completed_hours}h
                            </div>
                          )}
                        </div>
                        {canExpand && (
                          <svg
                            className={`w-3.5 h-3.5 text-text-muted transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
                            fill="none" viewBox="0 0 24 24" stroke="currentColor"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        )}
                      </div>
                    </div>

                    <AnimatePresence>
                      {isExpanded && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                          transition={{ duration: 0.2 }}
                          className="overflow-hidden"
                        >
                          <ExpandedDetails worker={worker} fmtTime={fmtTime} sourceLabel={sourceLabel} categories={categories} onRefresh={fetchWorkers} />
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </motion.div>
              )
            })}
          </AnimatePresence>
        </div>

        {!showAll && hiddenCount > 0 && (
          <button
            onClick={() => setShowAll(true)}
            className="mt-3 w-full text-center text-xs text-text-muted hover:text-primary-dark font-medium py-1.5 rounded-lg hover:bg-secondary/40 transition-colors"
          >
            {`Show ${hiddenCount} more (off duty)`}
          </button>
        )}
        {showAll && workers.some(w => !w.schedule && w.status !== 'clocked_in' && w.status !== 'on_break' && w.status !== 'clocked_out') && (
          <button
            onClick={() => setShowAll(false)}
            className="mt-3 w-full text-center text-xs text-text-muted hover:text-primary-dark font-medium py-1.5 rounded-lg hover:bg-secondary/40 transition-colors"
          >
            Hide off-duty staff
          </button>
        )}
      </div>
    </div>
  )
}

function ExpandedDetails({
  worker,
  fmtTime,
  sourceLabel,
  categories,
  onRefresh,
}: {
  worker: WorkerStatus
  fmtTime: (iso: string) => string
  sourceLabel: (source?: string | null) => string
  categories: TimeCategory[]
  onRefresh: () => void
}) {
  const dayEntries = worker.day_entries ?? []
  const hasDayEntries = dayEntries.length > 0
  const allBreaks = worker.breaks ?? []
  const isActive = worker.status === 'clocked_in' || worker.status === 'on_break'
  const isDone = worker.status === 'clocked_out'
  const isNotIn = !isActive && !isDone

  return (
    <div className="mt-2.5 pt-2.5 border-t border-neutral-warm/50">
      {hasDayEntries ? (
        <DayTimeline
          entries={dayEntries}
          workerStatus={worker.status}
          activeBreak={worker.active_break}
          fmtTime={fmtTime}
        />
      ) : (isActive || isDone) ? (
        <div className="space-y-0">
          <TimelineRow icon="clock_in" label="Clock In" time={worker.clock_in_at ? fmtTime(worker.clock_in_at) : '—'} color="emerald" />
          {allBreaks.map((b, i) => (
            <BreakTimelineRow key={i} breakItem={b} index={i + 1} fmtTime={fmtTime} />
          ))}
          {isDone && <TimelineRow icon="clock_out" label="Clock Out" time={worker.clock_out_at ? fmtTime(worker.clock_out_at) : '—'} color="blue" isLast />}
          {isActive && worker.active_break && <TimelineRow icon="on_break" label="On Break" time="Now" color="amber" isLast />}
        </div>
      ) : null}

      {isNotIn && !hasDayEntries && worker.schedule && (
        <div className="text-xs text-text-muted">
          Scheduled: {worker.schedule.start_time} – {worker.schedule.end_time}
        </div>
      )}

      {(isActive || isDone) && (
        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
          <div className="bg-white rounded-lg py-1.5 px-2 border border-neutral-warm/50">
            <div className="text-xs font-semibold text-primary-dark">{worker.completed_hours}h</div>
            <div className="text-[9px] text-text-muted uppercase tracking-wider mt-0.5">Worked</div>
          </div>
          <div className="bg-white rounded-lg py-1.5 px-2 border border-neutral-warm/50">
            <div className={`text-xs font-semibold ${worker.active_break ? 'text-amber-600' : 'text-primary-dark'}`}>
              {allBreaks.length > 0 ? `${worker.total_break_minutes}m (${allBreaks.length})` : '0m'}
            </div>
            <div className="text-[9px] text-text-muted uppercase tracking-wider mt-0.5">Breaks</div>
          </div>
          <div className="bg-white rounded-lg py-1.5 px-2 border border-neutral-warm/50">
            <div className="text-xs font-semibold text-primary-dark">{sourceLabel(worker.clock_source)}</div>
            <div className="text-[9px] text-text-muted uppercase tracking-wider mt-0.5">Source</div>
          </div>
        </div>
      )}

      {(isActive || isDone) && (
        <div className="mt-2 grid grid-cols-2 gap-2 text-center">
          <div className="bg-white rounded-lg py-1.5 px-2 border border-neutral-warm/50">
            <div className="text-xs font-semibold text-primary-dark">{worker.time_category?.name || '—'}</div>
            <div className="text-[9px] text-text-muted uppercase tracking-wider mt-0.5">{dayEntries.length > 1 ? 'Current Category' : 'Category'}</div>
          </div>
          <div className="bg-white rounded-lg py-1.5 px-2 border border-neutral-warm/50">
            <div className="text-xs font-semibold text-primary-dark">
              {worker.schedule ? `${worker.schedule.start_time} – ${worker.schedule.end_time}` : 'None'}
            </div>
            <div className="text-[9px] text-text-muted uppercase tracking-wider mt-0.5">Schedule</div>
          </div>
        </div>
      )}

      <AdminActions worker={worker} categories={categories} onRefresh={onRefresh} />
    </div>
  )
}

function DayTimeline({
  entries,
  workerStatus,
  activeBreak,
  fmtTime,
}: {
  entries: WorkerDayEntry[]
  workerStatus: string
  activeBreak: boolean
  fmtTime: (iso: string) => string
}) {
  const totalEntries = entries.length
  let breakCounter = 0

  return (
    <div className="space-y-0">
      {entries.map((entry, idx) => {
        const isFirst = idx === 0
        const isLast = idx === totalEntries - 1
        const nextEntry = idx < totalEntries - 1 ? entries[idx + 1] : null
        const isEntryActive = entry.status === 'clocked_in' || entry.status === 'on_break'
        const catName = entry.time_category?.name

        const rows: JSX.Element[] = []

        if (isFirst) {
          rows.push(
            <TimelineRow
              key={`in-${entry.id}`}
              icon="clock_in"
              label={catName ? `Clock In — ${catName}` : 'Clock In'}
              time={entry.clock_in_at ? fmtTime(entry.clock_in_at) : '—'}
              color="emerald"
            />
          )
        } else {
          rows.push(
            <TimelineRow
              key={`switch-${entry.id}`}
              icon="switch"
              label={catName ? `Switched to ${catName}` : 'Switched category'}
              time={entry.clock_in_at ? fmtTime(entry.clock_in_at) : '—'}
              color="cyan"
            />
          )
        }

        for (const b of entry.breaks) {
          breakCounter++
          rows.push(
            <BreakTimelineRow key={`break-${entry.id}-${breakCounter}`} breakItem={b} index={breakCounter} fmtTime={fmtTime} />
          )
        }

        if (isLast) {
          if (isEntryActive && activeBreak) {
            rows.push(
              <TimelineRow key={`onbreak-${entry.id}`} icon="on_break" label="On Break" time="Now" color="amber" isLast />
            )
          } else if (workerStatus === 'clocked_out' && entry.clock_out_at) {
            rows.push(
              <TimelineRow key={`out-${entry.id}`} icon="clock_out" label="Clock Out" time={fmtTime(entry.clock_out_at)} color="blue" isLast />
            )
          }
        } else if (nextEntry) {
          if (entry.hours > 0) {
            rows.push(
              <div key={`dur-${entry.id}`} className="flex items-start gap-2.5 relative">
                <div className="flex flex-col items-center">
                  <div className="w-px flex-1 bg-neutral-warm/60 min-h-[12px]" />
                </div>
                <div className="pb-0.5">
                  <span className="text-[10px] text-text-muted/60 italic">{entry.hours}h on {catName || 'this category'}</span>
                </div>
              </div>
            )
          }
        }

        return rows
      })}
    </div>
  )
}

function AdminActions({
  worker,
  categories,
  onRefresh,
}: {
  worker: WorkerStatus
  categories: TimeCategory[]
  onRefresh: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [selectedCatId, setSelectedCatId] = useState<string>('')
  const [switchCatId, setSwitchCatId] = useState<string>('')

  const isActive = worker.status === 'clocked_in' || worker.status === 'on_break'
  const isNotIn = !isActive && worker.status !== 'clocked_out'
  const userId = worker.user.id

  const run = async (fn: () => Promise<{ error?: string | null }>) => {
    setBusy(true)
    setActionError(null)
    try {
      const res = await fn()
      if (res.error) {
        setActionError(res.error)
      } else {
        onRefresh()
      }
    } catch {
      setActionError('Action failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-3 pt-2.5 border-t border-neutral-warm/40" onClick={e => e.stopPropagation()}>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-2">Admin Actions</p>

      {actionError && (
        <p className="text-xs text-red-600 mb-2 bg-red-50 border border-red-200 rounded-lg px-2 py-1">{actionError}</p>
      )}

      {isNotIn && (
        <div className="flex items-center gap-2 flex-wrap">
          {categories.length > 0 && (
            <select
              value={selectedCatId}
              onChange={e => setSelectedCatId(e.target.value)}
              className="text-xs border border-neutral-warm rounded-lg px-2 py-1.5 bg-white text-primary-dark flex-1 min-w-[120px]"
            >
              <option value="">Category...</option>
              {categories.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          )}
          <button
            disabled={busy}
            onClick={() => run(() => api.clockIn(userId, true, selectedCatId ? Number(selectedCatId) : undefined))}
            className="text-xs font-semibold bg-emerald-500 text-white rounded-lg px-3 py-1.5 hover:bg-emerald-600 disabled:opacity-50 transition-colors"
          >
            {busy ? 'Clocking In...' : 'Clock In'}
          </button>
        </div>
      )}

      {isActive && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            {worker.status === 'clocked_in' && (
              <button
                disabled={busy}
                onClick={() => run(() => api.startBreak(userId))}
                className="text-xs font-semibold bg-amber-100 text-amber-800 border border-amber-300 rounded-lg px-3 py-1.5 hover:bg-amber-200 disabled:opacity-50 transition-colors"
              >
                Start Break
              </button>
            )}
            {worker.status === 'on_break' && (
              <button
                disabled={busy}
                onClick={() => run(() => api.endBreak(userId))}
                className="text-xs font-semibold bg-indigo-100 text-indigo-800 border border-indigo-300 rounded-lg px-3 py-1.5 hover:bg-indigo-200 disabled:opacity-50 transition-colors"
              >
                End Break
              </button>
            )}
            <button
              disabled={busy}
              onClick={() => run(() => api.clockOut(undefined, undefined, userId))}
              className="text-xs font-semibold bg-red-100 text-red-700 border border-red-300 rounded-lg px-3 py-1.5 hover:bg-red-200 disabled:opacity-50 transition-colors"
            >
              Clock Out
            </button>
          </div>
          {categories.length > 1 && (
            <div className="flex items-center gap-2">
              <select
                value={switchCatId}
                onChange={e => setSwitchCatId(e.target.value)}
                className="text-xs border border-neutral-warm rounded-lg px-2 py-1.5 bg-white text-primary-dark flex-1 min-w-[120px]"
              >
                <option value="">Switch to...</option>
                {categories.filter(c => c.id !== worker.time_category?.id).map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              <button
                disabled={busy || !switchCatId}
                onClick={() => run(() => api.switchCategory(Number(switchCatId), userId))}
                className="text-xs font-semibold bg-cyan-100 text-cyan-800 border border-cyan-300 rounded-lg px-3 py-1.5 hover:bg-cyan-200 disabled:opacity-50 transition-colors"
              >
                Switch
              </button>
            </div>
          )}
        </div>
      )}

      {worker.status === 'clocked_out' && (
        <p className="text-xs text-text-muted italic">Shift completed. Use Time Tracking to edit entries.</p>
      )}
    </div>
  )
}

function TimelineRow({
  icon,
  label,
  time,
  color,
  isLast = false,
}: {
  icon: string
  label: string
  time: string
  color: 'emerald' | 'blue' | 'amber' | 'cyan'
  isLast?: boolean
}) {
  const dotColor: Record<string, string> = {
    emerald: 'bg-emerald-500',
    blue: 'bg-blue-500',
    amber: 'bg-amber-400',
    cyan: 'bg-cyan-500',
  }

  const textColor: Record<string, string> = {
    emerald: 'text-emerald-700',
    blue: 'text-blue-700',
    amber: 'text-amber-700',
    cyan: 'text-cyan-700',
  }

  const isDiamond = icon === 'switch'

  return (
    <div className="flex items-start gap-2.5 relative">
      <div className="flex flex-col items-center">
        {isDiamond ? (
          <div className={`w-2.5 h-2.5 mt-0.5 shrink-0 z-10 rotate-45 rounded-sm ${dotColor[color]}`} />
        ) : (
          <div className={`w-2.5 h-2.5 rounded-full ${dotColor[color]} mt-0.5 shrink-0 z-10 ${icon === 'on_break' ? 'animate-pulse' : ''}`} />
        )}
        {!isLast && <div className="w-px flex-1 bg-neutral-warm/60 min-h-[16px]" />}
      </div>
      <div className="flex items-baseline gap-2 pb-1.5">
        <span className={`text-[11px] font-semibold ${textColor[color]}`}>{label}</span>
        <span className="text-[11px] text-text-muted">{time}</span>
      </div>
    </div>
  )
}

function BreakTimelineRow({
  breakItem,
  index,
  fmtTime,
}: {
  breakItem: WorkerBreak
  index: number
  fmtTime: (iso: string) => string
}) {
  const startTime = fmtTime(breakItem.start_time)
  const endTime = breakItem.end_time ? fmtTime(breakItem.end_time) : null
  const duration = breakItem.duration_minutes

  return (
    <>
      <div className="flex items-start gap-2.5 relative">
        <div className="flex flex-col items-center">
          <div className={`w-2.5 h-2.5 rounded-full mt-0.5 shrink-0 z-10 ${breakItem.active ? 'bg-amber-400 animate-pulse' : 'bg-amber-300'}`} />
          <div className="w-px flex-1 bg-neutral-warm/60 min-h-[16px]" />
        </div>
        <div className="flex items-baseline gap-1.5 pb-1.5 flex-wrap">
          <span className="text-[11px] font-medium text-amber-700">Break {index}</span>
          <span className="text-[11px] text-text-muted">
            {startTime}
            {endTime ? ` – ${endTime}` : ''}
          </span>
          {duration != null && (
            <span className="text-[10px] text-text-muted/70">({duration}m)</span>
          )}
          {breakItem.active && (
            <span className="text-[10px] font-semibold text-amber-600">Active</span>
          )}
        </div>
      </div>
    </>
  )
}
