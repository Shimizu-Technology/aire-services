import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { api } from '../../lib/api'
import type { TimeEntry } from '../../lib/api'

interface ApprovalQueueProps {
  onUpdate?: () => void
}

export default function ApprovalQueue({ onUpdate }: ApprovalQueueProps) {
  const [entries, setEntries] = useState<TimeEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState(false)
  const [actionLoading, setActionLoading] = useState<number | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [noteInput, setNoteInput] = useState<{ id: number; note: string } | null>(null)
  const [expandedDescriptions, setExpandedDescriptions] = useState<Set<number>>(new Set())

  const fetchPending = useCallback(async () => {
    try {
      const result = await api.getPendingApprovals()
      if (result.data) {
        setEntries(result.data.pending_entries)
        const freshIds = new Set(result.data.pending_entries.map((e: { id: number }) => e.id))
        setExpandedDescriptions(prev => {
          const pruned = new Set<number>()
          for (const id of prev) {
            if (freshIds.has(id)) pruned.add(id)
          }
          return pruned.size === prev.size ? prev : pruned
        })
        setFetchError(false)
      } else if (result.error) {
        setFetchError(true)
      }
    } catch {
      setFetchError(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchPending()
    const interval = setInterval(fetchPending, 30000)
    return () => clearInterval(interval)
  }, [fetchPending])

  const handleApprove = async (entry: TimeEntry, note?: string) => {
    setActionLoading(entry.id)
    setActionError(null)
    try {
      const isOvertimeOnly = entry.approval_status !== 'pending' && entry.overtime_status === 'pending'
      const result = isOvertimeOnly
        ? await api.approveOvertime(entry.id, note)
        : await api.approveTimeEntry(entry.id, note)

      if (result.error) {
        setActionError(result.error)
      } else {
        const stillHasOvertimePending = !isOvertimeOnly && entry.overtime_status === 'pending'
        if (stillHasOvertimePending) {
          await fetchPending()
        } else {
          setEntries(prev => prev.filter(e => e.id !== entry.id))
        }
        setNoteInput(null)
        onUpdate?.()
      }
    } catch {
      setActionError('Failed to approve entry. Please try again.')
    } finally {
      setActionLoading(null)
    }
  }

  const handleDeny = async (entry: TimeEntry, note?: string) => {
    setActionLoading(entry.id)
    setActionError(null)
    try {
      const isOvertimeOnly = entry.approval_status !== 'pending' && entry.overtime_status === 'pending'
      const result = isOvertimeOnly
        ? await api.denyOvertime(entry.id, note)
        : await api.denyTimeEntry(entry.id, note)

      if (result.error) {
        setActionError(result.error)
      } else {
        const stillHasOvertimePending = !isOvertimeOnly && entry.overtime_status === 'pending'
        if (stillHasOvertimePending) {
          await fetchPending()
        } else {
          setEntries(prev => prev.filter(e => e.id !== entry.id))
        }
        setNoteInput(null)
        onUpdate?.()
      }
    } catch {
      setActionError('Failed to deny entry. Please try again.')
    } finally {
      setActionLoading(null)
    }
  }

  if (loading) {
    return (
      <div className="bg-white rounded-2xl shadow-sm border border-neutral-warm p-5 animate-pulse">
        <div className="h-5 bg-neutral-warm rounded w-36 mb-4" />
        <div className="space-y-3">
          <div className="h-16 bg-neutral-warm/60 rounded-xl" />
          <div className="h-16 bg-neutral-warm/60 rounded-xl" />
        </div>
      </div>
    )
  }

  if (fetchError) {
    return (
      <div className="bg-white rounded-2xl shadow-sm border border-red-200 p-5">
        <div className="flex items-center gap-2.5 mb-2">
          <svg className="w-5 h-5 text-red-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
          </svg>
          <h3 className="font-semibold text-red-700 text-sm">Could not load pending approvals</h3>
        </div>
        <p className="text-xs text-text-muted mb-3">There may be entries awaiting your review.</p>
        <button
          onClick={() => { setLoading(true); fetchPending(); }}
          className="min-h-[44px] px-4 py-2 bg-white hover:bg-secondary border border-neutral-warm text-primary-dark text-sm font-medium rounded-xl transition-colors"
        >
          Retry
        </button>
      </div>
    )
  }

  if (entries.length === 0) return null

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-amber-200/70 overflow-hidden hover:shadow-md transition-shadow duration-300">
      <div className="h-1 bg-amber-400" />
      <div className="p-5">
        <div className="flex items-center gap-2.5 mb-4">
          <div className="w-6 h-6 bg-amber-50 border border-amber-200 rounded-full flex items-center justify-center">
            <span className="text-amber-600 text-xs font-bold">{entries.length}</span>
          </div>
          <h3 className="font-semibold text-primary-dark text-base">Pending Approvals</h3>
        </div>

        {actionError && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2 mb-3 flex items-center justify-between gap-2">
            <p className="text-xs text-red-700">{actionError}</p>
            <button onClick={() => setActionError(null)} className="text-red-400 hover:text-red-600 shrink-0">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}

        <div className="space-y-3">
          <AnimatePresence>
            {entries.map(entry => {
              const isPendingApproval = entry.approval_status === 'pending'
              const isPendingOvertime = entry.overtime_status === 'pending'

              return (
                <motion.div
                  key={entry.id}
                  layout
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: -100 }}
                  className="border border-neutral-warm rounded-xl p-3.5 bg-secondary/30"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-primary-dark text-sm">
                          {entry.user.full_name || entry.user.display_name}
                        </span>
                        {isPendingApproval && (
                          <span className="px-2 py-0.5 text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200 rounded-full uppercase tracking-wider">
                            Manual
                          </span>
                        )}
                        {isPendingOvertime && (
                          <span className="px-2 py-0.5 text-[10px] font-semibold bg-orange-50 text-orange-700 border border-orange-200 rounded-full uppercase tracking-wider">
                            Overtime
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-text-muted mt-1">
                        {new Date(entry.work_date + 'T00:00:00').toLocaleDateString('en-US', {
                          weekday: 'short', month: 'short', day: 'numeric'
                        })}
                        {' · '}
                        {entry.formatted_start_time && entry.formatted_end_time
                          ? `${entry.formatted_start_time} – ${entry.formatted_end_time}`
                          : `${entry.hours}h`
                        }
                      </div>
                      {entry.description && (
                        <div className="mt-1">
                          <p className={`text-xs text-text-muted ${
                            !expandedDescriptions.has(entry.id) && entry.description.length > 60 ? 'line-clamp-1' : ''
                          }`}>
                            {entry.description}
                          </p>
                          {entry.description.length > 60 && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                setExpandedDescriptions(prev => {
                                  const next = new Set(prev)
                                  if (next.has(entry.id)) next.delete(entry.id)
                                  else next.add(entry.id)
                                  return next
                                })
                              }}
                              className="text-primary text-[11px] font-medium hover:underline mt-0.5"
                            >
                              {expandedDescriptions.has(entry.id) ? 'Show less' : 'Show more'}
                            </button>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="text-right shrink-0">
                      <div className="text-lg font-bold text-primary-dark">{entry.hours}h</div>
                      <div className="text-[10px] text-text-muted uppercase">{entry.entry_method}</div>
                    </div>
                  </div>

                  {/* Note Input */}
                  {noteInput?.id === entry.id && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      className="mt-3"
                    >
                      <input
                        type="text"
                        value={noteInput.note}
                        onChange={e => setNoteInput({ ...noteInput, note: e.target.value })}
                        placeholder="Add a note (optional)..."
                        className="w-full px-3 py-2 text-sm border border-neutral-warm rounded-xl bg-white text-primary-dark placeholder:text-text-muted/60 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                      />
                    </motion.div>
                  )}

                  {/* Actions */}
                  <div className="flex items-center gap-2 mt-3">
                    <button
                      onClick={() => handleApprove(entry, noteInput?.id === entry.id ? noteInput.note : undefined)}
                      disabled={actionLoading === entry.id}
                      className="flex-1 min-h-[44px] py-2 px-3 bg-primary hover:bg-primary-dark active:bg-primary-dark disabled:opacity-50 text-white text-sm font-medium rounded-xl transition-colors shadow-sm"
                    >
                      {actionLoading === entry.id ? 'Processing...' : 'Approve'}
                    </button>
                    <button
                      onClick={() => handleDeny(entry, noteInput?.id === entry.id ? noteInput.note : undefined)}
                      disabled={actionLoading === entry.id}
                      className="flex-1 min-h-[44px] py-2 px-3 bg-white hover:bg-secondary active:bg-secondary-dark disabled:opacity-50 text-red-600 text-sm font-medium rounded-xl transition-colors border border-red-200"
                    >
                      Deny
                    </button>
                    <button
                      onClick={() => setNoteInput(noteInput?.id === entry.id ? null : { id: entry.id, note: '' })}
                      className="min-h-[44px] min-w-[44px] py-2 px-3 bg-white hover:bg-secondary border border-neutral-warm text-text-muted text-sm rounded-xl transition-colors flex items-center justify-center"
                      title="Add note"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
                      </svg>
                    </button>
                  </div>
                </motion.div>
              )
            })}
          </AnimatePresence>
        </div>
      </div>
    </div>
  )
}
