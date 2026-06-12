import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { api } from '../../lib/api'
import type {
  ApprovalGroupFilter,
  ApprovalGroupOption,
  ApprovalReason,
  PendingApprovalsParams,
  PendingApprovalsSummary,
  TimeCategory,
  TimeEntry,
} from '../../lib/api'
import { formatDateISO, formatWorkDate } from '../../lib/dateUtils'
import EditTimeEntryModal from './EditTimeEntryModal'

interface ApprovalQueueProps {
  approvalGroups: ApprovalGroupOption[]
  approvalGroupsLoaded: boolean
  onUpdate?: () => void
  canDeleteEntry?: (entry: TimeEntry) => boolean
}

type DateMode = 'all' | 'exact' | 'range' | 'through' | 'since'
type SortField = NonNullable<PendingApprovalsParams['sort']>
type SortDirection = NonNullable<PendingApprovalsParams['direction']>

interface ReviewFilters {
  dateMode: DateMode
  date: string
  startDate: string
  endDate: string
  throughDate: string
  sinceDate: string
  userId: string
  categoryId: string
  approvalType: '' | 'time_entry' | 'overtime' | 'both'
  entryMethod: '' | 'clock' | 'manual'
  clockSource: '' | 'kiosk' | 'mobile' | 'admin' | 'legacy'
  sort: SortField
  direction: SortDirection
  groupByDate: boolean
}

const defaultReviewFilters: ReviewFilters = {
  dateMode: 'all',
  date: '',
  startDate: '',
  endDate: '',
  throughDate: '',
  sinceDate: '',
  userId: '',
  categoryId: '',
  approvalType: '',
  entryMethod: '',
  clockSource: '',
  sort: 'work_date',
  direction: 'asc',
  groupByDate: true,
}

function entryApprovalGroupKeys(entry: TimeEntry) {
  return entry.user.approval_group_keys ?? (entry.user.approval_group ? [entry.user.approval_group] : [])
}

function filterEntriesByGroup(entries: TimeEntry[], filter: 'all' | ApprovalGroupFilter) {
  if (filter === 'all') return entries
  if (filter === 'unassigned') return entries.filter((entry) => entryApprovalGroupKeys(entry).length === 0)
  return entries.filter((entry) => entryApprovalGroupKeys(entry).includes(filter))
}

function parseLocalDate(dateString: string) {
  return new Date(`${dateString}T00:00:00`)
}

function formatCompactDate(dateString: string | null | undefined) {
  if (!dateString) return '—'
  return parseLocalDate(dateString).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function getWeekBounds(date: Date) {
  const start = new Date(date)
  start.setDate(start.getDate() - start.getDay())
  const end = new Date(start)
  end.setDate(start.getDate() + 6)
  return { start: formatDateISO(start), end: formatDateISO(end) }
}

function getPreviousWeekBounds(date: Date) {
  const thisWeek = new Date(date)
  thisWeek.setDate(thisWeek.getDate() - thisWeek.getDay() - 7)
  return getWeekBounds(thisWeek)
}

function buildPendingApprovalParams(filters: ReviewFilters): Omit<PendingApprovalsParams, 'approval_group'> {
  const params: Omit<PendingApprovalsParams, 'approval_group'> = {
    sort: filters.sort,
    direction: filters.direction,
    per_page: 500,
  }

  if (filters.dateMode === 'exact' && filters.date) params.date = filters.date
  if (filters.dateMode === 'range') {
    if (filters.startDate) params.start_date = filters.startDate
    if (filters.endDate) params.end_date = filters.endDate
  }
  if (filters.dateMode === 'through' && filters.throughDate) params.through_date = filters.throughDate
  if (filters.dateMode === 'since' && filters.sinceDate) params.since_date = filters.sinceDate
  if (filters.userId) params.user_id = Number(filters.userId)
  if (filters.categoryId) params.time_category_id = Number(filters.categoryId)
  if (filters.approvalType) params.approval_type = filters.approvalType
  if (filters.entryMethod) params.entry_method = filters.entryMethod
  if (filters.clockSource) params.clock_source = filters.clockSource

  return params
}

function hasActiveReviewFilters(filters: ReviewFilters) {
  return Boolean(
    filters.dateMode !== 'all' ||
    filters.userId ||
    filters.categoryId ||
    filters.approvalType ||
    filters.entryMethod ||
    filters.clockSource,
  )
}

function fallbackApprovalReasons(entry: TimeEntry): ApprovalReason[] {
  const reasons: ApprovalReason[] = []
  const note = (entry.approval_note ?? '').toLowerCase()

  if (entry.approval_status === 'pending') {
    if (note.includes('corrected clock-out')) reasons.push({ key: 'corrected_clock_out', label: 'Corrected clock-out' })
    if (note.includes('employee edited')) reasons.push({ key: 'employee_edited', label: 'Employee edited' })

    if (entry.entry_method === 'manual') reasons.push({ key: 'manual_entry', label: 'Manual entry' })
    else if (entry.entry_method === 'clock' && (!entry.schedule || note.includes('without a schedule'))) reasons.push({ key: 'unscheduled_clock', label: 'Unscheduled clock' })
    else if (reasons.length === 0) reasons.push({ key: 'time_review', label: 'Needs time review' })
  }

  if (entry.overtime_status === 'pending') reasons.push({ key: 'overtime', label: 'Overtime' })
  if (entry.admin_override) reasons.push({ key: 'admin_override', label: 'Admin override' })

  return reasons.filter((reason, index, list) => list.findIndex((item) => item.key === reason.key) === index)
}

function approvalReasonsFor(entry: TimeEntry) {
  return entry.approval_reasons?.length ? entry.approval_reasons : fallbackApprovalReasons(entry)
}

function reasonTone(key: string) {
  switch (key) {
    case 'overtime':
      return 'border-orange-200 bg-orange-50 text-orange-700'
    case 'unscheduled_clock':
    case 'corrected_clock_out':
      return 'border-sky-200 bg-sky-50 text-sky-700'
    case 'employee_edited':
      return 'border-violet-200 bg-violet-50 text-violet-700'
    case 'admin_override':
      return 'border-slate-200 bg-slate-50 text-slate-600'
    default:
      return 'border-amber-200 bg-amber-50 text-amber-700'
  }
}

function entryDisplayName(entry: TimeEntry) {
  return entry.user.full_name || entry.user.display_name || entry.user.email?.split('@')[0] || 'Unknown team member'
}

function entryStartLabel(entry: TimeEntry) {
  if (entry.formatted_start_time && entry.formatted_end_time) return `${entry.formatted_start_time} – ${entry.formatted_end_time}`
  return `${entry.hours}h`
}

function summarizeSelectedEntries(entries: TimeEntry[]) {
  const dates = entries.map((entry) => entry.work_date).sort()
  const totalHours = entries.reduce((sum, entry) => sum + entry.hours, 0)
  const firstDate = dates[0]
  const lastDate = dates[dates.length - 1]
  const dateLabel = firstDate === lastDate ? formatWorkDate(firstDate) : `${formatWorkDate(firstDate)} through ${formatWorkDate(lastDate)}`
  return { totalHours, dateLabel }
}

function SummaryMetric({ label, value, sublabel, tone = 'default' }: { label: string; value: string; sublabel?: string; tone?: 'default' | 'warning' | 'success' }) {
  const toneClass = tone === 'warning' ? 'text-amber-700' : tone === 'success' ? 'text-emerald-700' : 'text-primary-dark'
  return (
    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-text-muted">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${toneClass}`}>{value}</p>
      {sublabel && <p className="mt-1 text-xs text-text-muted">{sublabel}</p>}
    </div>
  )
}

function summaryCountForApprovalGroup(summary: PendingApprovalsSummary | null, key: ApprovalGroupFilter) {
  return summary?.counts_by_approval_group?.find((row) => row.key === key)?.count
}

export default function ApprovalQueue({ approvalGroups, approvalGroupsLoaded, onUpdate, canDeleteEntry }: ApprovalQueueProps) {
  const [allEntries, setAllEntries] = useState<TimeEntry[]>([])
  const [entries, setEntries] = useState<TimeEntry[]>([])
  const [categories, setCategories] = useState<TimeCategory[]>([])
  const [summary, setSummary] = useState<PendingApprovalsSummary | null>(null)
  const [allSummary, setAllSummary] = useState<PendingApprovalsSummary | null>(null)
  const [approvalGroupFilter, setApprovalGroupFilter] = useState<'all' | ApprovalGroupFilter>('all')
  const [reviewFilters, setReviewFilters] = useState<ReviewFilters>(defaultReviewFilters)
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState(false)
  const [actionLoading, setActionLoading] = useState<number | null>(null)
  const [bulkActionLoading, setBulkActionLoading] = useState(false)
  const [refreshingFilter, setRefreshingFilter] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [noteInput, setNoteInput] = useState<{ id: number; note: string } | null>(null)
  const [expandedDescriptions, setExpandedDescriptions] = useState<Set<number>>(new Set())
  const [editingEntry, setEditingEntry] = useState<TimeEntry | null>(null)
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('aire_pending_approvals_collapsed') === 'true')
  const fetchGenerationRef = useRef(0)

  const activeReviewFilters = hasActiveReviewFilters(reviewFilters)

  const syncExpandedDescriptions = useCallback((visibleEntries: TimeEntry[]) => {
    const freshIds = new Set(visibleEntries.map((entry) => entry.id))
    setExpandedDescriptions(prev => {
      const pruned = new Set<number>()
      for (const id of prev) {
        if (freshIds.has(id)) pruned.add(id)
      }
      return pruned.size === prev.size ? prev : pruned
    })
  }, [])

  const fetchPending = useCallback(async (filter: 'all' | ApprovalGroupFilter) => {
    const requestId = ++fetchGenerationRef.current

    try {
      const baseParams = buildPendingApprovalParams(reviewFilters)
      const [allResult, filteredResult] = await Promise.all([
        api.getPendingApprovals(baseParams),
        filter === 'all' ? Promise.resolve(null) : api.getPendingApprovals({ ...baseParams, approval_group: filter }),
      ])

      if (requestId !== fetchGenerationRef.current) return

      const allData = allResult.data
      const visibleData = filter === 'all' ? allData : filteredResult?.data

      if (allData && visibleData) {
        const allPendingEntries = allData.pending_entries ?? []
        const visibleEntries = visibleData.pending_entries ?? []
        setAllEntries(allPendingEntries)
        setEntries(visibleEntries)
        setAllSummary(allData.summary ?? null)
        setSummary(visibleData.summary ?? null)
        syncExpandedDescriptions(visibleEntries)
        setFetchError(false)
      } else {
        setFetchError(true)
      }
    } catch {
      if (requestId === fetchGenerationRef.current) {
        setFetchError(true)
      }
    } finally {
      if (requestId === fetchGenerationRef.current) {
        setLoading(false)
        setRefreshingFilter(false)
      }
    }
  }, [reviewFilters, syncExpandedDescriptions])

  useEffect(() => {
    fetchPending(approvalGroupFilter)
    const interval = setInterval(() => {
      void fetchPending(approvalGroupFilter)
    }, 30000)
    return () => clearInterval(interval)
  }, [approvalGroupFilter, fetchPending])

  useEffect(() => {
    api.getTimeCategories()
      .then((result) => {
        if (result.data?.time_categories) {
          setCategories(result.data.time_categories)
        }
      })
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    const visibleIds = new Set(entries.map((entry) => entry.id))
    setSelectedIds((previous) => {
      const next = new Set<number>()
      previous.forEach((id) => {
        if (visibleIds.has(id)) next.add(id)
      })
      return next.size === previous.size ? previous : next
    })
  }, [entries])

  const toggleCollapsed = () => {
    setCollapsed((value) => {
      const next = !value
      localStorage.setItem('aire_pending_approvals_collapsed', String(next))
      return next
    })
  }

  const filterOptions: Array<{ value: 'all' | ApprovalGroupFilter; label: string; count: number }> = [
    { value: 'all', label: 'All', count: allSummary?.entry_count ?? allEntries.length },
    ...approvalGroups.map((group) => ({
      value: group.key,
      label: group.label,
      count: summaryCountForApprovalGroup(allSummary, group.key) ?? allEntries.filter((entry) => entryApprovalGroupKeys(entry).includes(group.key)).length,
    })),
    { value: 'unassigned', label: 'Unassigned', count: summaryCountForApprovalGroup(allSummary, 'unassigned') ?? allEntries.filter((entry) => entryApprovalGroupKeys(entry).length === 0).length },
  ]

  const userOptions = useMemo(() => {
    const usersById = new Map<number, { id: number; label: string }>()
    allEntries.forEach((entry) => {
      usersById.set(entry.user.id, { id: entry.user.id, label: entryDisplayName(entry) })
    })
    return Array.from(usersById.values()).sort((a, b) => a.label.localeCompare(b.label))
  }, [allEntries])

  const selectedEntries = useMemo(() => entries.filter((entry) => selectedIds.has(entry.id)), [entries, selectedIds])
  const allVisibleSelected = entries.length > 0 && entries.every((entry) => selectedIds.has(entry.id))

  const groupedEntries = useMemo(() => {
    const groups = entries.reduce((acc, entry) => {
      if (!acc[entry.work_date]) acc[entry.work_date] = []
      acc[entry.work_date].push(entry)
      return acc
    }, {} as Record<string, TimeEntry[]>)

    const sortDirection = reviewFilters.sort === 'work_date' ? reviewFilters.direction : 'asc'
    return Object.entries(groups)
      .sort(([left], [right]) => sortDirection === 'desc' ? right.localeCompare(left) : left.localeCompare(right))
      .map(([date, groupEntries]) => ({
        date,
        entries: groupEntries,
        totalHours: groupEntries.reduce((sum, entry) => sum + entry.hours, 0),
      }))
  }, [entries, reviewFilters.direction, reviewFilters.sort])

  const toggleEntrySelection = (entryId: number) => {
    setSelectedIds((previous) => {
      const next = new Set(previous)
      if (next.has(entryId)) next.delete(entryId)
      else next.add(entryId)
      return next
    })
  }

  const toggleSelectAllVisible = () => {
    setSelectedIds((previous) => {
      if (allVisibleSelected) return new Set()
      const next = new Set(previous)
      entries.forEach((entry) => next.add(entry.id))
      return next
    })
  }

  const toggleGroupSelection = (groupEntries: TimeEntry[]) => {
    const groupSelected = groupEntries.every((entry) => selectedIds.has(entry.id))
    setSelectedIds((previous) => {
      const next = new Set(previous)
      groupEntries.forEach((entry) => {
        if (groupSelected) next.delete(entry.id)
        else next.add(entry.id)
      })
      return next
    })
  }

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
        await fetchPending(approvalGroupFilter)
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
        await fetchPending(approvalGroupFilter)
        setNoteInput(null)
        onUpdate?.()
      }
    } catch {
      setActionError('Failed to deny entry. Please try again.')
    } finally {
      setActionLoading(null)
    }
  }

  const handleBulkApproveSelected = async () => {
    if (selectedEntries.length === 0) return
    if (selectedEntries.length > 100) {
      setActionError('Approve at most 100 entries at a time. Narrow the filters or select fewer entries.')
      return
    }

    const selectedSummary = summarizeSelectedEntries(selectedEntries)
    if (!confirm(`Approve ${selectedEntries.length} selected entr${selectedEntries.length === 1 ? 'y' : 'ies'}?\n\nDate range: ${selectedSummary.dateLabel}\nTotal hours: ${selectedSummary.totalHours.toFixed(2)}h`)) return

    setBulkActionLoading(true)
    setActionError(null)
    try {
      const result = await api.bulkApproveTimeEntries(selectedEntries.map((entry) => entry.id))
      if (result.error) {
        setActionError(result.error)
        return
      }

      setSelectedIds(new Set())
      await fetchPending(approvalGroupFilter)
      setNoteInput(null)
      onUpdate?.()
    } catch {
      setActionError('Failed to approve selected entries. Please try again.')
    } finally {
      setBulkActionLoading(false)
    }
  }

  const handleEditSaved = async () => {
    setEditingEntry(null)
    await fetchPending(approvalGroupFilter)
    onUpdate?.()
  }

  const handleEditDeleted = async () => {
    setEditingEntry(null)
    await fetchPending(approvalGroupFilter)
    onUpdate?.()
  }

  const applyFilter = (filter: 'all' | ApprovalGroupFilter) => {
    setApprovalGroupFilter(filter)

    if (allEntries.length > 0) {
      const filteredEntries = filterEntriesByGroup(allEntries, filter)
      setEntries(filteredEntries)
      syncExpandedDescriptions(filteredEntries)
      setRefreshingFilter(true)
    }
  }

  const updateReviewFilters = (updates: Partial<ReviewFilters>) => {
    setReviewFilters((previous) => ({ ...previous, ...updates }))
    setRefreshingFilter(true)
  }

  const clearReviewFilters = () => {
    setReviewFilters((previous) => ({
      ...defaultReviewFilters,
      sort: previous.sort,
      direction: previous.direction,
      groupByDate: previous.groupByDate,
    }))
    setRefreshingFilter(true)
  }

  const applyQuickDateFilter = (kind: 'today' | 'yesterday' | 'this_week' | 'last_week' | 'through_today') => {
    const today = new Date()
    if (kind === 'today') {
      const date = formatDateISO(today)
      updateReviewFilters({ dateMode: 'exact', date })
      return
    }

    if (kind === 'yesterday') {
      const yesterday = new Date(today)
      yesterday.setDate(today.getDate() - 1)
      updateReviewFilters({ dateMode: 'exact', date: formatDateISO(yesterday) })
      return
    }

    if (kind === 'this_week') {
      const bounds = getWeekBounds(today)
      updateReviewFilters({ dateMode: 'range', startDate: bounds.start, endDate: bounds.end })
      return
    }

    if (kind === 'last_week') {
      const bounds = getPreviousWeekBounds(today)
      updateReviewFilters({ dateMode: 'range', startDate: bounds.start, endDate: bounds.end })
      return
    }

    updateReviewFilters({ dateMode: 'through', throughDate: formatDateISO(today) })
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
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0Zm-9 3.75h.008v.008H12v-.008Z" />
          </svg>
          <h3 className="font-semibold text-red-700 text-sm">Could not load pending approvals</h3>
        </div>
        <p className="text-xs text-text-muted mb-3">There may be entries awaiting your review.</p>
        <button
          onClick={() => { setLoading(true); void fetchPending(approvalGroupFilter); }}
          className="min-h-[44px] px-4 py-2 bg-white hover:bg-secondary border border-neutral-warm text-primary-dark text-sm font-medium rounded-xl transition-colors"
        >
          Retry
        </button>
      </div>
    )
  }

  const displaySummary = summary ?? {
    total_hours: entries.reduce((sum, entry) => sum + entry.hours, 0),
    entry_count: entries.length,
    oldest_work_date: entries.map((entry) => entry.work_date).sort()[0] ?? null,
    newest_work_date: entries.map((entry) => entry.work_date).sort().at(-1) ?? null,
    pending_time_entry_count: entries.filter((entry) => entry.approval_status === 'pending').length,
    pending_overtime_count: entries.filter((entry) => entry.overtime_status === 'pending').length,
    manual_count: entries.filter((entry) => entry.entry_method === 'manual').length,
    clock_count: entries.filter((entry) => entry.entry_method === 'clock').length,
    counts_by_date: [],
    counts_by_approval_group: [],
  }
  const throughDate = reviewFilters.dateMode === 'through' ? reviewFilters.throughDate : ''

  const renderEntryCard = (entry: TimeEntry) => {
    const isPendingApproval = entry.approval_status === 'pending'
    const isPendingOvertime = entry.overtime_status === 'pending'
    const selected = selectedIds.has(entry.id)
    const reasons = approvalReasonsFor(entry)

    return (
      <motion.div
        key={entry.id}
        layout
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, x: -100 }}
        className={`border rounded-xl p-3.5 transition-colors ${selected ? 'border-primary bg-cyan-50/50' : 'border-neutral-warm bg-secondary/30'}`}
      >
        <div className="flex items-start gap-3">
          <label className="mt-1 inline-flex min-h-[44px] min-w-[44px] cursor-pointer items-start justify-center rounded-xl border border-slate-200 bg-white pt-3 hover:border-primary/50" title="Select for bulk approval">
            <input
              type="checkbox"
              className="h-4 w-4 accent-primary"
              checked={selected}
              onChange={() => toggleEntrySelection(entry.id)}
              aria-label={`Select ${entryDisplayName(entry)} on ${formatWorkDate(entry.work_date)}`}
            />
          </label>

          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-primary-dark text-sm">
                    {entryDisplayName(entry)}
                  </span>
                  {reasons.map((reason) => (
                    <span key={reason.key} className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${reasonTone(reason.key)}`}>
                      {reason.label}
                    </span>
                  ))}
                </div>
                <div className="text-xs text-text-muted mt-1">
                  {formatWorkDate(entry.work_date)} · {entryStartLabel(entry)}
                </div>
                <div className="mt-1 flex flex-wrap gap-1.5 text-[10px] uppercase tracking-[0.12em] text-text-muted">
                  <span>{entry.time_category?.name || 'Uncategorized'}</span>
                  <span>·</span>
                  <span>{entry.entry_method}</span>
                  {entry.clock_source && <><span>·</span><span>{entry.clock_source}</span></>}
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
                        onClick={(event) => {
                          event.stopPropagation()
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

            {noteInput?.id === entry.id && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                className="mt-3"
              >
                <input
                  type="text"
                  value={noteInput.note}
                  onChange={event => setNoteInput({ ...noteInput, note: event.target.value })}
                  placeholder="Add a note (optional)..."
                  className="w-full px-3 py-2 text-sm border border-neutral-warm rounded-xl bg-white text-primary-dark placeholder:text-text-muted/60 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                />
              </motion.div>
            )}

            <div className="flex items-center gap-2 mt-3">
              <button
                onClick={() => handleApprove(entry, noteInput?.id === entry.id ? noteInput.note : undefined)}
                disabled={actionLoading === entry.id || (!isPendingApproval && !isPendingOvertime)}
                className="flex-1 min-h-[44px] py-2 px-3 bg-primary hover:bg-primary-dark active:bg-primary-dark disabled:opacity-50 text-white text-sm font-medium rounded-xl transition-colors shadow-sm"
              >
                {actionLoading === entry.id ? 'Processing...' : 'Approve'}
              </button>
              <button
                onClick={() => handleDeny(entry, noteInput?.id === entry.id ? noteInput.note : undefined)}
                disabled={actionLoading === entry.id || (!isPendingApproval && !isPendingOvertime)}
                className="flex-1 min-h-[44px] py-2 px-3 bg-white hover:bg-secondary active:bg-secondary-dark disabled:opacity-50 text-red-600 text-sm font-medium rounded-xl transition-colors border border-red-200"
              >
                Deny
              </button>
              <button
                onClick={() => setEditingEntry(entry)}
                className="min-h-[44px] min-w-[44px] py-2 px-3 bg-white hover:bg-secondary border border-neutral-warm text-text-muted text-sm rounded-xl transition-colors flex items-center justify-center"
                title="Edit entry"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
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
          </div>
        </div>
      </motion.div>
    )
  }

  return (
    <>
    <div className="bg-white rounded-2xl shadow-sm border border-amber-200/70 overflow-hidden hover:shadow-md transition-shadow duration-300">
      <div className="h-1 bg-amber-400" />
      <div className="p-5">
        <div className="mb-4 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <button type="button" onClick={toggleCollapsed} className="flex min-h-[44px] items-center gap-2.5 text-left">
            <div className="w-8 h-8 bg-amber-50 border border-amber-200 rounded-full flex items-center justify-center">
              <span className="text-amber-600 text-xs font-bold">{allSummary?.entry_count ?? allEntries.length}</span>
            </div>
            <div>
              <h3 className="font-semibold text-primary-dark text-base">Pending Approvals</h3>
              <p className="text-xs text-text-muted">{collapsed ? 'Collapsed — expand to review, filter, edit, or approve entries.' : 'Review the oldest unapproved hours first, then clear date ranges with confidence.'}</p>
            </div>
            <svg className={`h-4 w-4 text-text-muted transition-transform ${collapsed ? '' : 'rotate-180'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {!collapsed && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={toggleSelectAllVisible}
                disabled={entries.length === 0}
                className="min-h-[44px] rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-primary-dark transition hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50"
              >
                {allVisibleSelected ? 'Clear selection' : `Select filtered (${entries.length})`}
              </button>
              <button
                type="button"
                onClick={handleBulkApproveSelected}
                disabled={bulkActionLoading || selectedEntries.length === 0 || selectedEntries.length > 100}
                className="min-h-[44px] rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {bulkActionLoading ? 'Approving…' : `Approve Selected (${selectedEntries.length})`}
              </button>
            </div>
          )}
        </div>

        {collapsed ? (
          <div className="flex flex-wrap gap-2 rounded-xl border border-amber-100 bg-amber-50/60 px-4 py-3 text-xs text-amber-900">
            {filterOptions.map((option) => <span key={option.value} className="rounded-full bg-white px-2.5 py-1 font-semibold">{option.label}: {option.count}</span>)}
          </div>
        ) : <>
        <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <SummaryMetric label="Filtered pending" value={`${displaySummary.entry_count}`} sublabel={`${displaySummary.total_hours.toFixed(2)}h awaiting review`} tone={displaySummary.entry_count > 0 ? 'warning' : 'success'} />
          <SummaryMetric label="Oldest" value={formatCompactDate(displaySummary.oldest_work_date)} sublabel="Default queue starts here" />
          <SummaryMetric label="Newest" value={formatCompactDate(displaySummary.newest_work_date)} sublabel="Latest pending work date" />
          <SummaryMetric label="Review types" value={`${displaySummary.pending_time_entry_count}/${displaySummary.pending_overtime_count}`} sublabel="Time entries / overtime" />
        </div>

        {throughDate && (
          <div className={`mb-4 rounded-2xl border px-4 py-3 text-sm ${entries.length === 0 ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-900'}`}>
            {entries.length === 0
              ? `No pending approvals through ${formatWorkDate(throughDate)} in this view.`
              : `${entries.length} pending entr${entries.length === 1 ? 'y' : 'ies'} still need review through ${formatWorkDate(throughDate)}.`}
          </div>
        )}

        <div className="mb-4 rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.12em] text-text-muted">Date filter</label>
              <select
                value={reviewFilters.dateMode}
                onChange={(event) => updateReviewFilters({ dateMode: event.target.value as DateMode })}
                className="w-full rounded-xl border border-neutral-warm bg-white px-3 py-2 text-sm text-primary-dark focus:outline-none focus:ring-2 focus:ring-primary/30"
              >
                <option value="all">All dates</option>
                <option value="exact">Exact date</option>
                <option value="through">On or before</option>
                <option value="since">On or after</option>
                <option value="range">Date range</option>
              </select>
            </div>

            {reviewFilters.dateMode === 'exact' && (
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.12em] text-text-muted">Work date</label>
                <input type="date" value={reviewFilters.date} onChange={(event) => updateReviewFilters({ date: event.target.value })} className="w-full rounded-xl border border-neutral-warm bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
              </div>
            )}
            {reviewFilters.dateMode === 'through' && (
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.12em] text-text-muted">Through date</label>
                <input type="date" value={reviewFilters.throughDate} onChange={(event) => updateReviewFilters({ throughDate: event.target.value })} className="w-full rounded-xl border border-neutral-warm bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
              </div>
            )}
            {reviewFilters.dateMode === 'since' && (
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.12em] text-text-muted">Starting date</label>
                <input type="date" value={reviewFilters.sinceDate} onChange={(event) => updateReviewFilters({ sinceDate: event.target.value })} className="w-full rounded-xl border border-neutral-warm bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
              </div>
            )}
            {reviewFilters.dateMode === 'range' && (
              <>
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.12em] text-text-muted">Start</label>
                  <input type="date" value={reviewFilters.startDate} onChange={(event) => updateReviewFilters({ startDate: event.target.value })} className="w-full rounded-xl border border-neutral-warm bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.12em] text-text-muted">End</label>
                  <input type="date" value={reviewFilters.endDate} onChange={(event) => updateReviewFilters({ endDate: event.target.value })} className="w-full rounded-xl border border-neutral-warm bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
                </div>
              </>
            )}

            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.12em] text-text-muted">Employee</label>
              <select value={reviewFilters.userId} onChange={(event) => updateReviewFilters({ userId: event.target.value })} className="w-full rounded-xl border border-neutral-warm bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30">
                <option value="">All employees</option>
                {userOptions.map((user) => <option key={user.id} value={user.id}>{user.label}</option>)}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.12em] text-text-muted">Category</label>
              <select value={reviewFilters.categoryId} onChange={(event) => updateReviewFilters({ categoryId: event.target.value })} className="w-full rounded-xl border border-neutral-warm bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30">
                <option value="">All categories</option>
                {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.12em] text-text-muted">Review type</label>
              <select value={reviewFilters.approvalType} onChange={(event) => updateReviewFilters({ approvalType: event.target.value as ReviewFilters['approvalType'] })} className="w-full rounded-xl border border-neutral-warm bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30">
                <option value="">All review types</option>
                <option value="time_entry">Time entry review</option>
                <option value="overtime">Overtime review</option>
                <option value="both">Time entry + overtime</option>
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.12em] text-text-muted">Method</label>
              <select value={reviewFilters.entryMethod} onChange={(event) => updateReviewFilters({ entryMethod: event.target.value as ReviewFilters['entryMethod'] })} className="w-full rounded-xl border border-neutral-warm bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30">
                <option value="">Clock + manual</option>
                <option value="manual">Manual only</option>
                <option value="clock">Clock only</option>
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.12em] text-text-muted">Source</label>
              <select value={reviewFilters.clockSource} onChange={(event) => updateReviewFilters({ clockSource: event.target.value as ReviewFilters['clockSource'] })} className="w-full rounded-xl border border-neutral-warm bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30">
                <option value="">All sources</option>
                <option value="kiosk">Kiosk</option>
                <option value="mobile">Mobile</option>
                <option value="admin">Admin</option>
                <option value="legacy">Legacy</option>
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.12em] text-text-muted">Sort</label>
              <select value={reviewFilters.sort} onChange={(event) => updateReviewFilters({ sort: event.target.value as SortField })} className="w-full rounded-xl border border-neutral-warm bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30">
                <option value="work_date">Work date</option>
                <option value="created_at">Submitted time</option>
                <option value="employee">Employee</option>
                <option value="hours">Hours</option>
                <option value="approval_type">Review type</option>
                <option value="category">Category</option>
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.12em] text-text-muted">Direction</label>
              <select value={reviewFilters.direction} onChange={(event) => updateReviewFilters({ direction: event.target.value as SortDirection })} className="w-full rounded-xl border border-neutral-warm bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30">
                <option value="asc">Oldest / A–Z / low first</option>
                <option value="desc">Newest / Z–A / high first</option>
              </select>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-2">
              <button onClick={() => applyQuickDateFilter('through_today')} className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:border-primary/40 hover:text-primary">Through today</button>
              <button onClick={() => applyQuickDateFilter('today')} className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:border-primary/40 hover:text-primary">Today</button>
              <button onClick={() => applyQuickDateFilter('yesterday')} className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:border-primary/40 hover:text-primary">Yesterday</button>
              <button onClick={() => applyQuickDateFilter('this_week')} className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:border-primary/40 hover:text-primary">This week</button>
              <button onClick={() => applyQuickDateFilter('last_week')} className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:border-primary/40 hover:text-primary">Last week</button>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-600">
                <input type="checkbox" checked={reviewFilters.groupByDate} onChange={(event) => updateReviewFilters({ groupByDate: event.target.checked })} className="h-4 w-4 accent-primary" />
                Group by date
              </label>
              {activeReviewFilters && (
                <button onClick={clearReviewFilters} className="text-xs font-semibold text-primary hover:text-primary-dark">Clear filters</button>
              )}
            </div>
          </div>
        </div>

        <div className="-mx-1 mb-4 overflow-x-auto pb-1">
          <div className="flex min-w-max flex-nowrap gap-2 px-1">
          {approvalGroupsLoaded ? filterOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => applyFilter(option.value)}
              className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                approvalGroupFilter === option.value
                  ? 'border-cyan-200 bg-cyan-50 text-cyan-700'
                  : 'border-neutral-warm bg-white text-text-muted hover:border-slate-300 hover:text-primary-dark'
              }`}
            >
              {option.label} ({option.count})
            </button>
          )) : Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="h-8 w-24 animate-pulse rounded-full border border-neutral-warm bg-secondary/40" />
          ))}
          </div>
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

        {selectedEntries.length > 100 && (
          <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Bulk approvals are capped at 100 entries at a time. Select fewer entries or narrow the filters.
          </div>
        )}

        <div className={`transition-opacity ${refreshingFilter ? 'opacity-70' : 'opacity-100'}`}>
          {entries.length === 0 ? (
            <div className="rounded-xl border border-dashed border-neutral-warm bg-secondary/20 px-4 py-8 text-center text-sm text-text-muted">
              {activeReviewFilters ? 'No pending entries match these filters. If this was a date cutoff check, that range has been reviewed.' : 'No pending approvals right now.'}
            </div>
          ) : reviewFilters.groupByDate ? (
            <div className="space-y-4">
              {groupedEntries.map((group) => {
                const groupSelected = group.entries.every((entry) => selectedIds.has(entry.id))
                return (
                  <section key={group.date} className="rounded-2xl border border-slate-200 bg-white/70 p-3">
                    <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <button type="button" onClick={() => toggleGroupSelection(group.entries)} className="flex items-center gap-3 text-left">
                        <span className={`flex h-5 w-5 items-center justify-center rounded border ${groupSelected ? 'border-primary bg-primary text-white' : 'border-slate-300 bg-white'}`}>
                          {groupSelected && <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M16.704 5.29a1 1 0 0 1 .006 1.414l-7.25 7.312a1 1 0 0 1-1.42.002L3.29 9.23a1 1 0 1 1 1.42-1.408l4.04 4.07 6.54-6.596a1 1 0 0 1 1.414-.006Z" clipRule="evenodd" /></svg>}
                        </span>
                        <div>
                          <h4 className="text-sm font-bold text-primary-dark">{formatWorkDate(group.date)}</h4>
                          <p className="text-xs text-text-muted">{group.entries.length} entr{group.entries.length === 1 ? 'y' : 'ies'} · {group.totalHours.toFixed(2)}h pending</p>
                        </div>
                      </button>
                    </div>
                    <div className="space-y-3">
                      <AnimatePresence>
                        {group.entries.map(renderEntryCard)}
                      </AnimatePresence>
                    </div>
                  </section>
                )
              })}
            </div>
          ) : (
            <div className="space-y-3">
              <AnimatePresence>
                {entries.map(renderEntryCard)}
              </AnimatePresence>
            </div>
          )}
        </div>
        </>}
      </div>
    </div>
    <EditTimeEntryModal
      isOpen={!!editingEntry}
      entry={editingEntry}
      categories={categories}
      canDelete={!!editingEntry && !!canDeleteEntry?.(editingEntry)}
      onClose={() => setEditingEntry(null)}
      onSaved={handleEditSaved}
      onDeleted={handleEditDeleted}
      onError={setActionError}
    />
    </>
  )
}
