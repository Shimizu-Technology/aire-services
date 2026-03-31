import { useState, useEffect, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { api } from '../../lib/api'
import type { WorkerStatus } from '../../lib/api'

interface WhosWorkingProps {
  alwaysShow?: boolean
  dashboardStyle?: boolean
}

export default function WhosWorking({ alwaysShow = false, dashboardStyle = false }: WhosWorkingProps) {
  const [workers, setWorkers] = useState<WorkerStatus[]>([])
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined)

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
    pollRef.current = setInterval(fetchWorkers, 30_000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
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
    : workers.filter(w => w.schedule || w.status === 'clocked_in' || w.status === 'on_break')
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
            <p className="text-sm text-text-muted">No one is scheduled today</p>
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

  const sourceLabel = (source?: string | null) => ({ kiosk: 'Kiosk', mobile: 'Mobile', admin: 'Admin', legacy: 'Legacy' }[source || ''] || '—')

  return (
    <div className={cardClass}>
      {!dashboardStyle && <div className="h-1 bg-neutral-warm" />}
      <div className="p-5 flex-1">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-primary-dark text-base">Today's Team</h3>
          <div className="flex items-center gap-2">
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
              const isActive = worker.status === 'clocked_in' || worker.status === 'on_break'
              const isExpanded = expandedId === worker.user.id && isActive

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
                      isActive
                        ? 'bg-secondary/50 cursor-pointer hover:bg-secondary/70'
                        : 'hover:bg-secondary/30'
                    }`}
                    onClick={() => isActive && setExpandedId(isExpanded ? null : worker.user.id)}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={`w-2 h-2 rounded-full shrink-0 ${config.dot} ${
                          isActive ? 'animate-pulse' : ''
                        }`} />
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-primary-dark truncate">
                            {worker.user.full_name || worker.user.display_name}
                          </div>
                          {worker.schedule && !isActive && (
                            <div className="text-[11px] text-text-muted">
                              {worker.schedule.start_time} – {worker.schedule.end_time}
                            </div>
                          )}
                          {isActive && (
                            <div className="text-[11px] text-text-muted">
                              In since {worker.clock_in_at ? fmtTime(worker.clock_in_at) : '—'}
                              {worker.time_category?.name && <span className="ml-1">· {worker.time_category.name}</span>}
                              {worker.active_break && (
                                <span className="text-amber-600 font-medium ml-1">· On break</span>
                              )}
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
                        {isActive && (
                          <svg
                            className={`w-3.5 h-3.5 text-text-muted transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
                            fill="none" viewBox="0 0 24 24" stroke="currentColor"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        )}
                      </div>
                    </div>

                    {/* Expanded details */}
                    <AnimatePresence>
                      {isExpanded && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                          transition={{ duration: 0.2 }}
                          className="overflow-hidden"
                        >
                          <div className="mt-2.5 pt-2.5 border-t border-neutral-warm/50">
                            <div className="grid grid-cols-3 gap-2 text-center">
                              <div className="bg-white rounded-lg py-1.5 px-2 border border-neutral-warm/50">
                                <div className="text-xs font-semibold text-primary-dark">
                                  {worker.clock_in_at ? fmtTime(worker.clock_in_at) : '—'}
                                </div>
                                <div className="text-[9px] text-text-muted uppercase tracking-wider mt-0.5">Clock In</div>
                              </div>
                              <div className="bg-white rounded-lg py-1.5 px-2 border border-neutral-warm/50">
                                <div className={`text-xs font-semibold ${worker.active_break ? 'text-amber-600' : 'text-primary-dark'}`}>
                                  {worker.total_break_minutes > 0
                                    ? `${worker.total_break_minutes}m`
                                    : worker.active_break ? 'Active' : '0m'}
                                </div>
                                <div className="text-[9px] text-text-muted uppercase tracking-wider mt-0.5">Breaks</div>
                              </div>
                              <div className="bg-white rounded-lg py-1.5 px-2 border border-neutral-warm/50">
                                <div className="text-xs font-semibold text-primary-dark">
                                  {worker.completed_hours}h
                                </div>
                                <div className="text-[9px] text-text-muted uppercase tracking-wider mt-0.5">Worked</div>
                              </div>
                            </div>
                            <div className="mt-2 grid grid-cols-2 gap-2 text-center">
                              <div className="bg-white rounded-lg py-1.5 px-2 border border-neutral-warm/50">
                                <div className="text-xs font-semibold text-primary-dark">
                                  {worker.time_category?.name || '—'}
                                </div>
                                <div className="text-[9px] text-text-muted uppercase tracking-wider mt-0.5">Category</div>
                              </div>
                              <div className="bg-white rounded-lg py-1.5 px-2 border border-neutral-warm/50">
                                <div className="text-xs font-semibold text-primary-dark">
                                  {sourceLabel(worker.clock_source)}
                                </div>
                                <div className="text-[9px] text-text-muted uppercase tracking-wider mt-0.5">Source</div>
                              </div>
                            </div>
                            {worker.schedule && (
                              <div className="mt-2 text-[11px] text-text-muted text-center">
                                Scheduled: {worker.schedule.start_time} – {worker.schedule.end_time} ({worker.schedule.hours}h)
                              </div>
                            )}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </motion.div>
              )
            })}
          </AnimatePresence>
        </div>

        {/* Toggle to show/hide off-duty staff */}
        {!showAll && hiddenCount > 0 && (
          <button
            onClick={() => setShowAll(true)}
            className="mt-3 w-full text-center text-xs text-text-muted hover:text-primary-dark font-medium py-1.5 rounded-lg hover:bg-secondary/40 transition-colors"
          >
            {`Show ${hiddenCount} more (off duty)`}
          </button>
        )}
        {showAll && workers.some(w => !w.schedule && w.status !== 'clocked_in' && w.status !== 'on_break') && (
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
