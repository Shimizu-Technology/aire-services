import { useState, useEffect, useCallback, useRef, Fragment } from 'react'
import { FadeUp, StaggerContainer, StaggerItem } from '../../components/ui/MotionComponents'
import { AnimatePresence, motion } from 'framer-motion'
import { useSearchParams } from 'react-router-dom'
import { api } from '../../lib/api'
import { Skeleton, SkeletonTimeEntry } from '../../components/ui/Skeleton'
import { FadeIn } from '../../components/ui/FadeIn'
import { formatDateISO } from '../../lib/dateUtils'
import ClockInOutCard from '../../components/time-tracking/ClockInOutCard'
import ApprovalQueue from '../../components/time-tracking/ApprovalQueue'
import WhosWorking from '../../components/time-tracking/WhosWorking'

// Local types to avoid Vite caching issues
interface TimeCategory {
  id: number
  key?: string | null
  name: string
  description: string | null
}

interface TimeEntryItem {
  id: number
  work_date: string
  start_time: string | null
  end_time: string | null
  formatted_start_time: string | null
  formatted_end_time: string | null
  hours: number
  break_minutes: number | null
  description: string | null
  entry_method?: 'clock' | 'manual'
  clock_source?: 'kiosk' | 'mobile' | 'admin' | 'legacy' | null
  status?: 'clocked_in' | 'on_break' | 'completed'
  approval_status?: 'pending' | 'approved' | 'denied' | null
  overtime_status?: 'none' | 'pending' | 'approved' | 'denied' | null
  attendance_status?: 'early' | 'on_time' | 'late' | null
  admin_override?: boolean
  clock_in_at?: string | null
  clock_out_at?: string | null
  approved_by?: { id: number; full_name: string } | null
  approved_at?: string | null
  approval_note?: string | null
  user: {
    id: number
    email: string
    display_name?: string
    full_name?: string
  }
  time_category: {
    id: number
    key?: string | null
    name: string
  } | null
  locked_at: string | null
  created_at: string
  updated_at: string
}

// Break duration presets
const BREAK_PRESETS = [
  { label: 'None', minutes: null },
  { label: '15m', minutes: 15 },
  { label: '30m', minutes: 30 },
  { label: '45m', minutes: 45 },
  { label: '1h', minutes: 60 },
  { label: 'Custom', minutes: -1 }, // -1 indicates custom
]

interface UserOption {
  id: number
  email: string
  display_name?: string
  full_name?: string
  role: string
}

// Icons
const PlusIcon = () => (
  <svg className="h-5 w-5" fill="none" aria-hidden="true" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
  </svg>
)

const ClockIcon = () => (
  <svg className="h-5 w-5" fill="none" aria-hidden="true" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
)

const EditIcon = () => (
  <svg className="h-4 w-4" fill="none" aria-hidden="true" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
  </svg>
)

const TrashIcon = () => (
  <svg className="h-4 w-4" fill="none" aria-hidden="true" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
  </svg>
)

const ChevronLeftIcon = () => (
  <svg className="h-5 w-5" fill="none" aria-hidden="true" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
  </svg>
)

const ChevronRightIcon = () => (
  <svg className="h-5 w-5" fill="none" aria-hidden="true" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
  </svg>
)

const ChartIcon = () => (
  <svg className="h-5 w-5" fill="none" aria-hidden="true" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
  </svg>
)

const LockIcon = () => (
  <svg className="h-3 w-3" fill="none" aria-hidden="true" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
  </svg>
)

// Helper functions
function formatDate(dateString: string): string {
  return new Date(dateString + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric'
  })
}

function getWeekDates(date: Date): Date[] {
  const start = new Date(date)
  const day = start.getDay()
  start.setDate(start.getDate() - day) // Start on Sunday
  
  const dates: Date[] = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    dates.push(d)
  }
  return dates
}

function isSameDay(date1: Date, date2: Date): boolean {
  return date1.getFullYear() === date2.getFullYear() &&
         date1.getMonth() === date2.getMonth() &&
         date1.getDate() === date2.getDate()
}

export default function TimeTracking() {
  useEffect(() => { document.title = 'Time Tracking | AIRE Ops' }, [])

  const [searchParams, setSearchParams] = useSearchParams()
  const [entries, setEntries] = useState<TimeEntryItem[]>([])
  const [entrySummary, setEntrySummary] = useState({ total_hours: 0, total_break_hours: 0, entry_count: 0 })
  const [categories, setCategories] = useState<TimeCategory[]>([])
  const [users, setUsers] = useState<UserOption[]>([])
  const [isAdmin, setIsAdmin] = useState(false)
  const [currentUserId, setCurrentUserId] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  
  // Tab: 'entries' or 'reports' — respect ?tab=reports from deep links
  const [activeTab, setActiveTab] = useState<'entries' | 'reports'>(
    searchParams.get('tab') === 'reports' ? 'reports' : 'entries'
  )
  
  // View mode: 'day' or 'week'
  const [viewMode, setViewMode] = useState<'day' | 'week'>('week')
  const [currentDate, setCurrentDate] = useState(new Date())
  
  // Entries filters (for Time Entries tab)
  const [entryFilters, setEntryFilters] = useState({
    user_id: '',
    time_category_id: '',
  })
  const [showDenied, setShowDenied] = useState(false)
  
  // Report filters
  const [reportFilters, setReportFilters] = useState({
    start_date: formatDateISO(new Date(new Date().getFullYear(), new Date().getMonth(), 1)), // First of month
    end_date: formatDateISO(new Date()),
    user_id: '',
    time_category_id: '',
    aire_only: false,
  })
  const [reportData, setReportData] = useState<TimeEntryItem[]>([])
  const [reportLoading, setReportLoading] = useState(false)
  const [reportSummary, setReportSummary] = useState({ total_hours: 0, total_break_hours: 0, entry_count: 0 })
  const [reportTruncated, setReportTruncated] = useState(false)
  
  const [currentWeekLocked, setCurrentWeekLocked] = useState(false)
  const [currentWeekLockId, setCurrentWeekLockId] = useState<number | null>(null)
  const [lockingWeek, setLockingWeek] = useState(false)
  
  // Person-day modal state (grouped calendar entries)
  const [personDayModal, setPersonDayModal] = useState<{ entries: TimeEntryItem[]; name: string; date: string } | null>(null)
  const returnToPersonDay = useRef<{ name: string; date: string; userId: number } | null>(null)

  // Modal state
  const [showModal, setShowModal] = useState(false)
  const [editingEntry, setEditingEntry] = useState<TimeEntryItem | null>(null)
  const [formData, setFormData] = useState({
    work_date: formatDateISO(new Date()),
    start_time: '08:00',
    end_time: '17:00',
    description: '',
    time_category_id: '',
    user_id: '',
    break_minutes: null as number | null
  })
  const [saving, setSaving] = useState(false)

  // Calculate hours from start/end times and break
  const calculateHours = (start: string, end: string, breakMins: number | null): number => {
    if (!start || !end) return 0
    const [startH, startM] = start.split(':').map(Number)
    const [endH, endM] = end.split(':').map(Number)
    const startMinutes = startH * 60 + startM
    const endMinutes = endH * 60 + endM
    let durationMinutes = endMinutes - startMinutes
    if (durationMinutes < 0) durationMinutes += 24 * 60 // Handle overnight
    if (breakMins) durationMinutes -= breakMins
    return Math.max(0, durationMinutes / 60)
  }

  const calculatedHours = calculateHours(formData.start_time, formData.end_time, formData.break_minutes)

  // Owner display: "You" for self, real name for others
  const ownerLabel = (entry: TimeEntryItem): string => {
    const name = entry.user.display_name || entry.user.full_name || entry.user.email.split('@')[0]
    if (currentUserId && entry.user.id === currentUserId) return 'You'
    return name
  }

  const currentWeekStartIso = useCallback((): string => {
    const weekStart = new Date(currentDate)
    weekStart.setDate(currentDate.getDate() - currentDate.getDay())
    return formatDateISO(weekStart)
  }, [currentDate])

  const dateIsInLockedWeek = useCallback((dateLike: Date | string): boolean => {
    if (!currentWeekLocked) return false
    const date = typeof dateLike === 'string' ? new Date(`${dateLike}T00:00:00`) : dateLike
    const weekStart = new Date(currentDate)
    weekStart.setDate(currentDate.getDate() - currentDate.getDay())
    const weekEnd = new Date(weekStart)
    weekEnd.setDate(weekStart.getDate() + 6)
    return date >= new Date(weekStart.toDateString()) && date <= new Date(weekEnd.toDateString())
  }, [currentDate, currentWeekLocked])

  // Load time entries
  const loadEntries = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const params: Record<string, string | number> = { per_page: 500 }
      
      if (viewMode === 'day') {
        params.date = formatDateISO(currentDate)
      } else {
        // Get week start (Sunday)
        const weekStart = new Date(currentDate)
        weekStart.setDate(currentDate.getDate() - currentDate.getDay())
        params.week = formatDateISO(weekStart)
      }

      // Apply filters
      if (entryFilters.user_id) {
        params.user_id = parseInt(entryFilters.user_id)
      }
      if (entryFilters.time_category_id) {
        params.time_category_id = parseInt(entryFilters.time_category_id)
      }

      const response = await api.getTimeEntries(params as unknown as Parameters<typeof api.getTimeEntries>[0])
      
      if (response.data) {
        setEntries(response.data.time_entries as unknown as TimeEntryItem[])
        setEntrySummary({
          total_hours: response.data.summary.total_hours,
          total_break_hours: response.data.summary.total_break_hours || 0,
          entry_count: response.data.summary.entry_count
        })
      } else {
        setError(response.error || 'Failed to load time entries')
      }
    } catch {
      setError('Failed to load time entries')
    } finally {
      setLoading(false)
    }
  }, [currentDate, viewMode, entryFilters])

  // Load categories and users
  const loadOptions = useCallback(async () => {
    try {
      const [catResponse, userResponse, currentUserResponse] = await Promise.all([
        api.getTimeCategories(),
        api.getUsers(),
        api.getCurrentUser()
      ])

      if (catResponse.data) {
        setCategories(catResponse.data.time_categories as unknown as TimeCategory[])
      }

      if (userResponse.data) {
        setUsers(userResponse.data.users.map(u => ({
          id: u.id,
          email: u.email,
          display_name: u.display_name,
          full_name: u.full_name,
          role: u.role
        })))
      }

      if (currentUserResponse.data) {
        setIsAdmin(currentUserResponse.data.user.is_admin)
        setCurrentUserId(currentUserResponse.data.user.id)
      }
    } catch {
      console.error('Failed to load options')
    }
  }, [])
  
  const loadWeekLockStatus = useCallback(async () => {
    try {
      const response = await api.getTimePeriodLockStatus(currentWeekStartIso())
      if (response.data) {
        setCurrentWeekLocked(response.data.locked)
        setCurrentWeekLockId(response.data.lock?.id ?? null)
      }
    } catch {
      // best-effort only
    }
  }, [currentWeekStartIso])

  const finalizeWeek = async () => {
    if (!isAdmin) return
    if (!confirm('Finalize and lock this week? No add/edit/delete will be allowed for this week.')) return

    setLockingWeek(true)
    try {
      const res = await api.lockTimePeriod(currentWeekStartIso(), 'Finalized from Time Tracking screen')
      if (res.error) {
        setError(res.error)
        return
      }
      await loadWeekLockStatus()
      await loadEntries()
    } finally {
      setLockingWeek(false)
    }
  }

  const unlockWeek = async () => {
    if (!isAdmin || !currentWeekLockId) return
    if (!confirm('Unlock this week? This re-opens add/edit/delete for this period.')) return

    setLockingWeek(true)
    try {
      const res = await api.unlockTimePeriod(currentWeekLockId)
      if (res.error) {
        setError(res.error)
        return
      }
      await loadWeekLockStatus()
      await loadEntries()
    } finally {
      setLockingWeek(false)
    }
  }

  // Load report data
  const loadReport = useCallback(async () => {
    setReportLoading(true)
    try {
      const params: Parameters<typeof api.getTimeEntries>[0] = {
        start_date: reportFilters.start_date,
        end_date: reportFilters.end_date,
        per_page: 500,
        exclude_approval_statuses: ['denied', 'pending'],
      }
      
      if (reportFilters.user_id) {
        params.user_id = parseInt(reportFilters.user_id)
      }
      if (reportFilters.time_category_id) {
        params.time_category_id = parseInt(reportFilters.time_category_id)
      }

      const response = await api.getTimeEntries(params)
      
      if (response.data) {
        const incoming = response.data.time_entries as unknown as TimeEntryItem[]
        const filtered = reportFilters.aire_only
          ? incoming.filter(entry => entry.time_category?.key?.startsWith('aire_'))
          : incoming
        setReportData(filtered)
        const totalHours = filtered.reduce((sum, entry) => sum + entry.hours, 0)
        const totalBreakHours = filtered.reduce((sum, entry) => sum + ((entry.break_minutes || 0) / 60), 0)
        setReportSummary({
          total_hours: totalHours,
          total_break_hours: totalBreakHours,
          entry_count: filtered.length
        })
        setReportTruncated(response.data.pagination?.truncated === true)
      }
    } catch {
      console.error('Failed to load report')
    } finally {
      setReportLoading(false)
    }
  }, [reportFilters])

  useEffect(() => {
    loadEntries()
  }, [loadEntries])

  useEffect(() => {
    loadOptions()
  }, [loadOptions])

  useEffect(() => {
    loadWeekLockStatus()
  }, [loadWeekLockStatus])
  
  useEffect(() => {
    if (activeTab === 'reports') {
      loadReport()
    }
  }, [activeTab, loadReport])

  // Clean up ?tab= from URL after reading it on mount
  useEffect(() => {
    if (searchParams.has('tab')) {
      searchParams.delete('tab')
      setSearchParams(searchParams, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Handle prefill from schedule
  useEffect(() => {
    const prefill = searchParams.get('prefill')
    if (prefill === 'true') {
      const date = searchParams.get('date') || formatDateISO(new Date())
      const startTime = searchParams.get('start_time') || '08:00'
      const endTime = searchParams.get('end_time') || '17:00'
      const notes = searchParams.get('notes') || ''
      
      // Open modal with pre-filled data
      setEditingEntry(null)
      setFormData({
        work_date: date,
        start_time: startTime,
        end_time: endTime,
        description: notes,
        time_category_id: '',
            user_id: currentUserId?.toString() || '',
        break_minutes: null
      })
      setShowModal(true)
      
      // Clear the URL params
      setSearchParams({})
    }
  }, [searchParams, setSearchParams])

  // Navigation
  const goToToday = () => setCurrentDate(new Date())
  
  const goToPrevious = () => {
    const newDate = new Date(currentDate)
    if (viewMode === 'day') {
      newDate.setDate(newDate.getDate() - 1)
    } else {
      newDate.setDate(newDate.getDate() - 7)
    }
    setCurrentDate(newDate)
  }

  const goToNext = () => {
    const newDate = new Date(currentDate)
    if (viewMode === 'day') {
      newDate.setDate(newDate.getDate() + 1)
    } else {
      newDate.setDate(newDate.getDate() + 7)
    }
    setCurrentDate(newDate)
  }

  // Modal handlers
  const openNewEntry = (date?: Date, prefillStart?: string, prefillEnd?: string, prefillNotes?: string) => {
    if (dateIsInLockedWeek(date || currentDate)) {
      setError('This time period is locked and cannot be modified')
      return
    }

    setEditingEntry(null)
    setFormData({
      work_date: formatDateISO(date || currentDate),
      start_time: prefillStart || '08:00',
      end_time: prefillEnd || '17:00',
      description: prefillNotes || '',
      time_category_id: '',
        user_id: currentUserId?.toString() || '',
      break_minutes: null
    })
    setShowModal(true)
  }

  const openEditEntry = (entry: TimeEntryItem) => {
    setEditingEntry(entry)
    setFormData({
      work_date: entry.work_date,
      start_time: entry.start_time || '08:00',
      end_time: entry.end_time || '17:00',
      description: entry.description || '',
      time_category_id: entry.time_category?.id.toString() || '',
      user_id: entry.user.id.toString(),
      break_minutes: entry.break_minutes
    })
    setShowModal(true)
  }

  const reopenPersonDayAfterLoad = useRef<{ name: string; date: string; userId: number } | null>(null)

  useEffect(() => {
    const ctx = reopenPersonDayAfterLoad.current
    if (!ctx) return
    reopenPersonDayAfterLoad.current = null
    const freshEntries = entries.filter(
      e => e.user.id === ctx.userId && e.work_date === ctx.date
    )
    if (freshEntries.length > 0) {
      setPersonDayModal({ entries: freshEntries, name: ctx.name, date: ctx.date })
    }
  }, [entries])

  const closeEditModal = () => {
    setShowModal(false)
    setEditingEntry(null)
    const ctx = returnToPersonDay.current
    if (ctx) {
      returnToPersonDay.current = null
      const freshEntries = entries.filter(
        e => e.user.id === ctx.userId && e.work_date === ctx.date
      )
      if (freshEntries.length > 0) {
        setPersonDayModal({ entries: freshEntries, name: ctx.name, date: ctx.date })
      }
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (dateIsInLockedWeek(formData.work_date)) {
      setError('This time period is locked and cannot be modified')
      return
    }

    if (!editingEntry && isAdmin && !formData.user_id) {
      setError('Please select an entry owner')
      return
    }

    setSaving(true)
    setError(null)

    try {
      const data = {
        work_date: formData.work_date,
        start_time: formData.start_time,
        end_time: formData.end_time,
        description: formData.description || undefined,
        time_category_id: formData.time_category_id ? parseInt(formData.time_category_id) : undefined,
        user_id: !editingEntry && isAdmin && formData.user_id ? parseInt(formData.user_id) : undefined,
        break_minutes: formData.break_minutes
      }

      if (editingEntry) {
        const response = await api.updateTimeEntry(editingEntry.id, data)
        if (response.error) {
          setError(response.error)
          return
        }
      } else {
        const response = await api.createTimeEntry(data)
        if (response.error) {
          setError(response.error)
          return
        }
      }

      reopenPersonDayAfterLoad.current = returnToPersonDay.current
      returnToPersonDay.current = null
      setShowModal(false)
      loadEntries()
    } catch {
      setError('Failed to save time entry')
    } finally {
      setSaving(false)
    }
  }

  const canDeleteEntry = (entry: TimeEntryItem): boolean => {
    if (dateIsInLockedWeek(entry.work_date) || !!entry.locked_at) return false
    if (isAdmin) return true
    return currentUserId === entry.user.id
  }

  const handleDelete = async (entry: TimeEntryItem) => {
    if (!canDeleteEntry(entry)) {
      setError('This time entry cannot be deleted (locked/finalized or insufficient permissions)')
      return
    }

    if (!confirm('Are you sure you want to delete this time entry?')) return

    try {
      const response = await api.deleteTimeEntry(entry.id)
      if (response.error) {
        setError(response.error)
        return
      }
      reopenPersonDayAfterLoad.current = returnToPersonDay.current
      returnToPersonDay.current = null
      setShowModal(false)
      setEditingEntry(null)
      loadEntries()
    } catch {
      setError('Failed to delete time entry')
    }
  }

  // Get week dates for week view
  const weekDates = getWeekDates(currentDate)

  // Filter out denied entries unless toggle is on
  const visibleEntries = showDenied
    ? entries
    : entries.filter(e => e.approval_status !== 'denied')

  // Group entries by date for week view
  const entriesByDate = visibleEntries.reduce((acc, entry) => {
    const date = entry.work_date
    if (!acc[date]) acc[date] = []
    acc[date].push(entry)
    return acc
  }, {} as Record<string, TimeEntryItem[]>)

  // Calculate hours per day
  const hoursPerDay = weekDates.reduce((acc, date) => {
    const dateStr = formatDateISO(date)
    const dayEntries = entriesByDate[dateStr] || []
    acc[dateStr] = dayEntries.reduce((sum, e) => sum + e.hours, 0)
    return acc
  }, {} as Record<string, number>)

  const deniedCount = entries.filter(e => e.approval_status === 'denied').length
  const deniedHours = entries.filter(e => e.approval_status === 'denied').reduce((sum, e) => sum + e.hours, 0)
  const visibleTotalHours = showDenied ? entrySummary.total_hours : entrySummary.total_hours - deniedHours

  // Calculate report summaries by category and user
  const reportByCategory = reportData.reduce((acc, entry) => {
    const catName = entry.time_category?.name || 'Uncategorized'
    if (!acc[catName]) acc[catName] = 0
    acc[catName] += entry.hours
    return acc
  }, {} as Record<string, number>)

  const reportByUser = reportData.reduce((acc, entry) => {
    const name = entry.user.display_name || entry.user.email.split('@')[0]
    if (!acc[name]) acc[name] = 0
    acc[name] += entry.hours
    return acc
  }, {} as Record<string, number>)

  const aireCategories = categories.filter(cat => cat.key?.startsWith('aire_'))

  const hoursSummaryByEmployeeCategory = reportData.reduce((acc, entry) => {
    const employeeName = entry.user.full_name || entry.user.display_name || entry.user.email.split('@')[0]
    const categoryName = entry.time_category?.name || 'Uncategorized'
    const key = `${employeeName}__${categoryName}`
    if (!acc[key]) {
      acc[key] = {
        employeeName,
        categoryName,
        hours: 0,
        breakHours: 0,
        entries: 0,
      }
    }
    acc[key].hours += entry.hours
    acc[key].breakHours += (entry.break_minutes || 0) / 60
    acc[key].entries += 1
    return acc
  }, {} as Record<string, { employeeName: string; categoryName: string; hours: number; breakHours: number; entries: number }>)

  const hoursSummaryRows = Object.values(hoursSummaryByEmployeeCategory).sort((a, b) => {
    if (a.employeeName === b.employeeName) return b.hours - a.hours
    return a.employeeName.localeCompare(b.employeeName)
  })

  const hoursSummaryTotal = hoursSummaryRows.reduce((acc, row) => acc + row.hours, 0)
  const hoursSummaryBreakTotal = hoursSummaryRows.reduce((acc, row) => acc + row.breakHours, 0)

  const reportBySource = reportData.reduce((acc, entry) => {
    const source = entry.clock_source || 'legacy'
    if (!acc[source]) acc[source] = 0
    acc[source] += entry.hours
    return acc
  }, {} as Record<string, number>)

  const exportHoursCsv = () => {
    const headers = ['Employee','Category','Work Hours','Break Hours','Net Hours','Entries','Date Range Start','Date Range End']
    const rows = hoursSummaryRows.map(row => [
      row.employeeName,
      row.categoryName,
      row.hours.toFixed(2),
      row.breakHours.toFixed(2),
      (row.hours - row.breakHours).toFixed(2),
      row.entries.toString(),
      reportFilters.start_date,
      reportFilters.end_date,
    ])
    const csv = [headers, ...rows]
      .map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(','))
      .join('\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `aire-hours-summary-${reportFilters.start_date}-to-${reportFilters.end_date}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <FadeUp>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-primary-dark tracking-tight">Time Tracking</h1>
          <p className="text-text-muted mt-1">Track your hours by work category, source, and pay period.</p>
        </div>
        {activeTab === 'entries' && (
          <button
            onClick={() => openNewEntry()}
            disabled={currentWeekLocked}
            className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary-dark transition-colors min-h-[44px] disabled:opacity-60 disabled:cursor-not-allowed"
            title={currentWeekLocked ? 'This week is locked' : 'Log Time'}
          >
            <PlusIcon />
            <span>Log Time</span>
          </button>
        )}
      </div>
      </FadeUp>

      {/* Clock In/Out Card - full width, horizontal on desktop */}
      <ClockInOutCard onStatusChange={() => loadEntries()} />

      {/* Admin Panels */}
      {isAdmin && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <ApprovalQueue onUpdate={() => loadEntries()} />
          <WhosWorking />
        </div>
      )}
      
      {/* Tab Navigation */}
      <div className="border-b border-neutral-warm">
        <nav className="flex gap-4">
          <button
            onClick={() => setActiveTab('entries')}
            className={`pb-3 px-1 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
              activeTab === 'entries'
                ? 'border-primary text-primary'
                : 'border-transparent text-text-muted hover:text-primary-dark'
            }`}
          >
            <ClockIcon />
            Time Entries
          </button>
          {isAdmin && (
            <button
              onClick={() => setActiveTab('reports')}
              className={`pb-3 px-1 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
                activeTab === 'reports'
                  ? 'border-primary text-primary'
                  : 'border-transparent text-text-muted hover:text-primary-dark'
              }`}
            >
              <ChartIcon />
              Reports
            </button>
          )}
        </nav>
      </div>

      {/* Entries Tab */}
      {activeTab === 'entries' && (
      <>
      {/* Filters (Admin only) */}
      {isAdmin && (
        <div className="bg-white rounded-2xl shadow-sm border border-neutral-warm p-4 hover:shadow-md transition-shadow duration-300">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm text-text-muted mb-1">Employee</label>
              <select
                value={entryFilters.user_id}
                onChange={(e) => setEntryFilters({ ...entryFilters, user_id: e.target.value })}
                className="w-full px-3 py-2 border border-neutral-warm rounded-lg focus:outline-none focus:ring-2 focus:ring-primary text-sm"
              >
                <option value="">All Employees</option>
                {users.map(user => (
                  <option key={user.id} value={user.id}>{user.display_name || user.email.split('@')[0]}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm text-text-muted mb-1">Category</label>
              <select
                value={entryFilters.time_category_id}
                onChange={(e) => setEntryFilters({ ...entryFilters, time_category_id: e.target.value })}
                className="w-full px-3 py-2 border border-neutral-warm rounded-lg focus:outline-none focus:ring-2 focus:ring-primary text-sm"
              >
                <option value="">All Categories</option>
                {categories.map(cat => (
                  <option key={cat.id} value={cat.id}>{cat.name}</option>
                ))}
              </select>
            </div>
            <div>
            </div>
          </div>
          {/* Clear filters button */}
          {(entryFilters.user_id || entryFilters.time_category_id) && (
            <button
              onClick={() => setEntryFilters({ user_id: '', time_category_id: '' })}
              className="mt-3 text-sm text-primary hover:text-primary-dark font-medium"
            >
              Clear all filters
            </button>
          )}
        </div>
      )}

      {/* View Controls */}
      <div className="bg-white rounded-2xl shadow-sm border border-neutral-warm p-4 hover:shadow-md transition-shadow duration-300">
        {/* Mobile Layout */}
        <div className="flex flex-col gap-4 sm:hidden">
          {/* Top row: Date range and total */}
          <div className="text-center">
            <div className="font-semibold text-primary-dark">
              {viewMode === 'day'
                ? currentDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
                : `${weekDates[0].toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${weekDates[6].toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
              }
            </div>
            <div className="text-sm text-primary-dark">
              Total: <span className="font-semibold text-primary">{visibleTotalHours.toFixed(1)} hours</span>
            </div>
          </div>
          {/* Bottom row: Toggle + Navigation */}
          <div className="flex items-center justify-between">
            <div className="flex rounded-lg overflow-hidden border border-neutral-warm">
              <button
                onClick={() => setViewMode('day')}
                className={`px-3 py-2 text-sm font-medium transition-colors ${
                  viewMode === 'day'
                    ? 'bg-primary text-white'
                    : 'bg-white text-primary-dark'
                }`}
              >
                Day
              </button>
              <button
                onClick={() => setViewMode('week')}
                className={`px-3 py-2 text-sm font-medium transition-colors ${
                  viewMode === 'week'
                    ? 'bg-primary text-white'
                    : 'bg-white text-primary-dark'
                }`}
              >
                Week
              </button>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={goToPrevious}
                className="p-2 text-primary-dark hover:bg-neutral-warm rounded-lg"
              >
                <ChevronLeftIcon />
              </button>
              <button
                onClick={goToToday}
                className={`px-2 py-1 text-sm font-medium rounded-lg ${
                  isSameDay(currentDate, new Date())
                    ? 'bg-primary text-white'
                    : 'text-primary-dark hover:bg-neutral-warm'
                }`}
              >
                Today
              </button>
              <button
                onClick={goToNext}
                className="p-2 text-primary-dark hover:bg-neutral-warm rounded-lg"
              >
                <ChevronRightIcon />
              </button>
            </div>
          </div>
        </div>

        {/* Desktop Layout */}
        <div className="hidden sm:grid grid-cols-3 items-center gap-4">
          {/* View Mode Toggle - Left */}
          <div className="flex rounded-lg overflow-hidden border border-neutral-warm w-fit">
            <button
              onClick={() => setViewMode('day')}
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                viewMode === 'day'
                  ? 'bg-primary text-white'
                  : 'bg-white text-primary-dark hover:bg-neutral-warm'
              }`}
            >
              Day
            </button>
            <button
              onClick={() => setViewMode('week')}
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                viewMode === 'week'
                  ? 'bg-primary text-white'
                  : 'bg-white text-primary-dark hover:bg-neutral-warm'
              }`}
            >
              Week
            </button>
          </div>

          {/* Date Navigation - Center */}
          <div className="flex items-center justify-center gap-2">
            <button
              onClick={goToPrevious}
              className="p-2 text-primary-dark hover:text-primary hover:bg-neutral-warm rounded-lg transition-colors"
            >
              <ChevronLeftIcon />
            </button>
            <button
              onClick={goToToday}
              className={`px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
                isSameDay(currentDate, new Date())
                  ? 'bg-primary text-white'
                  : 'text-primary-dark hover:text-primary hover:bg-neutral-warm'
              }`}
            >
              Today
            </button>
            <button
              onClick={goToNext}
              className="p-2 text-primary-dark hover:text-primary hover:bg-neutral-warm rounded-lg transition-colors"
            >
              <ChevronRightIcon />
            </button>
          </div>

          {/* Current Date Display - Right */}
          <div className="text-right">
            <div className="font-semibold text-primary-dark">
              {viewMode === 'day'
                ? currentDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
                : `${weekDates[0].toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${weekDates[6].toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
              }
            </div>
            <div className="text-sm text-primary-dark">
              Total: <span className="font-semibold text-primary">{visibleTotalHours.toFixed(1)} hours</span>
            </div>
          </div>
        </div>
      </div>

      {/* Week Lock Controls */}
      <div className={`rounded-xl border p-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 ${currentWeekLocked ? 'bg-amber-50 border-amber-200' : 'bg-white border-neutral-warm'}`}>
        <div className="text-sm">
          {currentWeekLocked ? (
            <span className="text-amber-700 font-medium">This week is finalized and locked. Adding, editing, and deleting time entries is disabled.</span>
          ) : (
            <span className="text-primary-dark">This week is currently open for time entry changes.</span>
          )}
        </div>
        {isAdmin && (
          <div className="flex items-center gap-2">
            {!currentWeekLocked ? (
              <button
                onClick={finalizeWeek}
                disabled={lockingWeek}
                className="px-3 py-2 text-sm font-medium rounded-lg bg-primary text-white hover:bg-primary-dark disabled:opacity-60"
              >
                {lockingWeek ? 'Locking...' : 'Finalize Week'}
              </button>
            ) : (
              <button
                onClick={unlockWeek}
                disabled={lockingWeek}
                className="px-3 py-2 text-sm font-medium rounded-lg bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-60"
              >
                {lockingWeek ? 'Unlocking...' : 'Unlock Week'}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Denied entries toggle */}
      {deniedCount > 0 && (
        <div className="flex items-center justify-end">
          <button
            onClick={() => setShowDenied(!showDenied)}
            className={`flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
              showDenied
                ? 'bg-red-50 border-red-200 text-red-700'
                : 'bg-white border-neutral-warm text-text-muted hover:text-primary-dark hover:border-primary/30'
            }`}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              {showDenied ? (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.878 9.878L3 3m6.878 6.878l4.242 4.242M21 21l-4.35-4.35" />
              )}
            </svg>
            {showDenied ? `Showing ${deniedCount} denied` : `${deniedCount} denied hidden`}
          </button>
        </div>
      )}

      {/* Error Display */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-800">
          {error}
        </div>
      )}

      {/* Loading Skeleton */}
      {loading ? (
        <div className="bg-white rounded-2xl shadow-sm border border-neutral-warm overflow-hidden hover:shadow-md transition-shadow duration-300">
          {/* Header skeleton */}
          <div className="p-4 border-b border-neutral-warm">
            <div className="flex items-center justify-between">
              <Skeleton height={20} className="w-32" />
              <Skeleton height={32} className="w-24 rounded-lg" />
            </div>
          </div>
          {/* Week view skeleton */}
          <div className="grid grid-cols-7 border-b border-neutral-warm">
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i} className="p-3 text-center border-r border-neutral-warm last:border-r-0">
                <Skeleton height={14} className="w-12 mx-auto mb-2" />
                <Skeleton height={24} className="w-8 mx-auto rounded-full" />
              </div>
            ))}
          </div>
          {/* Content skeleton */}
          <div className="divide-y divide-neutral-warm">
            {Array.from({ length: 3 }).map((_, i) => (
              <SkeletonTimeEntry key={i} />
            ))}
          </div>
        </div>
      ) : viewMode === 'week' ? (
        /* Week View */
        <FadeIn>
        <div className="bg-white rounded-2xl shadow-sm border border-neutral-warm overflow-hidden hover:shadow-md transition-shadow duration-300">
          <div className="overflow-x-auto">
            {/* Week Header */}
            <div className="grid grid-cols-7 border-b border-neutral-warm min-w-[600px]">
              {weekDates.map((date, idx) => {
                const dateStr = formatDateISO(date)
                const isToday = isSameDay(date, new Date())
                const dayHours = hoursPerDay[dateStr] || 0
                
                return (
                  <div
                    key={idx}
                    className={`p-2 sm:p-3 text-center border-r border-neutral-warm last:border-r-0 ${
                      isToday ? 'bg-primary/20 border-b-2 border-b-primary' : ''
                    }`}
                  >
                    <div className={`text-xs font-semibold uppercase ${isToday ? 'text-primary' : 'text-primary-dark'}`}>
                      {date.toLocaleDateString('en-US', { weekday: 'short' })}
                    </div>
                    <div className={`text-base sm:text-lg font-bold ${isToday ? 'text-primary' : 'text-primary-dark'}`}>
                      {date.getDate()}
                    </div>
                    <div className={`text-xs font-semibold ${isToday ? 'text-primary' : (dayHours > 0 ? 'text-primary' : 'text-primary-dark')}`}>
                      {dayHours.toFixed(1)}h
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Week Entries */}
            <div className="grid grid-cols-7 min-h-[250px] sm:min-h-[300px] min-w-[600px]">
              {weekDates.map((date, idx) => {
                const dateStr = formatDateISO(date)
                const dayEntries = entriesByDate[dateStr] || []
                const isToday = isSameDay(date, new Date())

                const groupedByUser = dayEntries.reduce((acc, entry) => {
                  const uid = entry.user.id
                  if (!acc[uid]) acc[uid] = []
                  acc[uid].push(entry)
                  return acc
                }, {} as Record<number, TimeEntryItem[]>)

                const userGroups = Object.values(groupedByUser)
                
                return (
                  <div
                    key={idx}
                    className={`border-r border-neutral-warm last:border-r-0 p-1 sm:p-2 ${
                      isToday ? 'bg-primary/10' : ''
                    }`}
                  >
                    {userGroups.map(userEntries => {
                      const totalHours = userEntries.reduce((s, e) => s + e.hours, 0)
                      const name = ownerLabel(userEntries[0])
                      const hasMultiple = userEntries.length > 1
                      const hasPending = userEntries.some(e => e.approval_status === 'pending')
                      const hasDenied = userEntries.some(e => e.approval_status === 'denied')
                      const hasLocked = userEntries.some(e => e.locked_at)
                      const firstStart = userEntries[0].formatted_start_time
                      const lastEnd = userEntries[userEntries.length - 1].formatted_end_time

                      if (!hasMultiple) {
                        const entry = userEntries[0]
                        return (
                          <div
                            key={entry.id}
                            className={`mb-1 sm:mb-2 p-1 sm:p-2 bg-white border rounded text-xs cursor-pointer hover:bg-neutral-warm/50 transition-colors shadow-sm ${entry.locked_at ? 'border-amber-300 bg-amber-50/30' : 'border-neutral-warm'}`}
                            onClick={() => openEditEntry(entry)}
                          >
                            <div className="font-bold text-primary-dark flex items-center gap-1">
                              {entry.locked_at ? <LockIcon /> : <ClockIcon />}
                              {entry.hours.toFixed(2)}h
                              {entry.approval_status === 'pending' && <span className="ml-auto w-2 h-2 rounded-full bg-amber-500" title="Pending approval" />}
                              {entry.approval_status === 'denied' && <span className="ml-auto w-2 h-2 rounded-full bg-red-500" title="Denied" />}
                            </div>
                            {entry.formatted_start_time && entry.formatted_end_time && (
                              <div className="text-primary-dark/70 text-[10px]">{entry.formatted_start_time} – {entry.formatted_end_time}</div>
                            )}
                            {entry.time_category && <div className="text-primary font-medium truncate text-[10px] sm:text-xs">{entry.time_category.name}</div>}
                            <div className="text-primary-dark/70 truncate text-[10px] mt-0.5">{name}</div>
                          </div>
                        )
                      }

                      return (
                        <CalendarUserGroup
                          key={userEntries[0].user.id}
                          entries={userEntries}
                          name={name}
                          totalHours={totalHours}
                          firstStart={firstStart}
                          lastEnd={lastEnd}
                          hasLocked={hasLocked}
                          hasPending={hasPending}
                          hasDenied={hasDenied}
                          onClick={() => setPersonDayModal({ entries: userEntries, name, date: formatDateISO(date) })}
                        />
                      )
                    })}
                    <button
                      onClick={() => openNewEntry(date)}
                      disabled={currentWeekLocked}
                      className="w-full p-1 sm:p-2 text-xs text-primary-dark font-medium hover:text-primary hover:bg-neutral-warm rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      title={currentWeekLocked ? 'This week is locked' : 'Add time entry'}
                    >
                      + Add
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
        </FadeIn>
      ) : (
        /* Day View */
        <FadeIn>
        <div className="bg-white rounded-2xl shadow-sm border border-neutral-warm hover:shadow-md transition-shadow duration-300">
          {visibleEntries.length === 0 ? (
            <div className="p-8 text-center">
              <div className="w-12 h-12 mx-auto mb-3 text-primary-dark">
                <ClockIcon />
              </div>
              <p className="text-primary-dark font-medium">No time entries for this day</p>
              <button
                onClick={() => openNewEntry()}
                className="mt-4 text-primary hover:text-primary-dark font-semibold"
              >
                Log your first entry
              </button>
            </div>
          ) : (
            <div className="divide-y divide-neutral-warm">
              {visibleEntries.map(entry => (
                <div key={entry.id} className={`p-3 sm:p-4 ${entry.locked_at ? 'bg-amber-50/30' : ''}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      {/* Hours + Time + Category Row */}
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`inline-flex items-center gap-1 px-2 sm:px-3 py-1 font-bold rounded-full text-sm ${entry.locked_at ? 'bg-amber-100 text-amber-700' : 'bg-primary/20 text-primary'}`}>
                          {entry.locked_at ? <LockIcon /> : <ClockIcon />}
                          {entry.hours}h
                        </span>
                        {entry.formatted_start_time && entry.formatted_end_time && (
                          <span className="text-xs sm:text-sm text-primary-dark/70">
                            {entry.formatted_start_time} - {entry.formatted_end_time}
                          </span>
                        )}
                        {entry.time_category && (
                          <span className="px-2 py-1 bg-primary/10 text-primary font-medium text-xs sm:text-sm rounded">
                            {entry.time_category.name}
                          </span>
                        )}
                        {entry.locked_at && (
                          <span className="px-2 py-1 bg-amber-100 text-amber-700 font-medium text-xs rounded">
                            Locked
                          </span>
                        )}
                        {entry.entry_method === 'clock' && (
                          <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 font-medium text-xs rounded">
                            Clock
                          </span>
                        )}
                        {entry.approval_status === 'pending' && (
                          <span className="px-2 py-0.5 bg-amber-100 text-amber-700 font-medium text-xs rounded">
                            Pending
                          </span>
                        )}
                        {entry.approval_status === 'denied' && (
                          <span className="px-2 py-0.5 bg-red-100 text-red-700 font-medium text-xs rounded">
                            Denied
                          </span>
                        )}
                        {entry.overtime_status === 'pending' && (
                          <span className="px-2 py-0.5 bg-orange-100 text-orange-700 font-medium text-xs rounded">
                            OT Pending
                          </span>
                        )}
                      </div>
                      {/* Owner */}
                      <p className="mt-1 text-xs sm:text-sm text-primary-dark/80 truncate">
                        by {ownerLabel(entry)}
                      </p>
                      {/* Description */}
                      {entry.description && (
                        <p className="mt-2 text-primary-dark text-sm">{entry.description}</p>
                      )}
                      {/* Client */}
                      {/* Approval info */}
                      {entry.approved_by && (
                        <div className="mt-2 text-xs text-text-muted border-t border-neutral-warm/50 pt-2">
                          <span className={entry.approval_status === 'approved' ? 'text-emerald-600' : 'text-red-500'}>
                            {entry.approval_status === 'approved' ? 'Approved' : 'Denied'} by {entry.approved_by.full_name}
                          </span>
                          {entry.approval_note && (
                            <p className="mt-0.5 text-primary-dark/70 italic">"{entry.approval_note}"</p>
                          )}
                        </div>
                      )}
                    </div>
                    {/* Actions */}
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => openEditEntry(entry)}
                        disabled={!!entry.locked_at}
                        className={`p-2 rounded-lg transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center ${entry.locked_at ? 'text-gray-300 cursor-not-allowed' : 'text-primary-dark hover:text-primary hover:bg-neutral-warm'}`}
                        title={entry.locked_at ? 'This entry is locked' : 'Edit entry'}
                      >
                        <EditIcon />
                      </button>
                      <button
                        onClick={() => handleDelete(entry)}
                        disabled={!canDeleteEntry(entry)}
                        className={`p-2 rounded-lg transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center ${!canDeleteEntry(entry) ? 'text-gray-300 cursor-not-allowed' : 'text-primary-dark hover:text-red-600 hover:bg-red-50'}`}
                        title={!canDeleteEntry(entry) ? 'This entry is locked/finalized or cannot be deleted' : 'Delete entry'}
                      >
                        <TrashIcon />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        </FadeIn>
      )}

      {/* Person Day Modal - shows all entries for one person on one day */}
      <AnimatePresence>
      {personDayModal && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50"
          onClick={(e) => { if (e.target === e.currentTarget) setPersonDayModal(null) }}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ duration: 0.25, delay: 0.1 }}
            className="bg-white rounded-2xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto"
          >
            <PersonDayModalContent
              entries={personDayModal.entries}
              name={personDayModal.name}
              dateLabel={formatDate(personDayModal.date)}
              isLocked={dateIsInLockedWeek(personDayModal.date)}
              onEditEntry={(entry) => {
                returnToPersonDay.current = { name: personDayModal.name, date: personDayModal.date, userId: entry.user.id }
                setPersonDayModal(null)
                openEditEntry(entry)
              }}
              onAddEntry={() => {
                const e = personDayModal.entries[0]
                const userId = e ? e.user.id : currentUserId
                returnToPersonDay.current = { name: personDayModal.name, date: personDayModal.date, userId: userId || 0 }
                setPersonDayModal(null)
                setEditingEntry(null)
                setFormData({
                  work_date: personDayModal.date,
                  start_time: '08:00',
                  end_time: '17:00',
                  description: '',
                  time_category_id: '',
                  user_id: userId?.toString() || '',
                  break_minutes: null
                })
                setShowModal(true)
              }}
              onDeleteEntry={async (entry) => {
                await handleDelete(entry)
                const remaining = personDayModal.entries.filter(e => e.id !== entry.id)
                if (remaining.length === 0) {
                  setPersonDayModal(null)
                } else {
                  setPersonDayModal({ ...personDayModal, entries: remaining })
                }
              }}
              canDelete={canDeleteEntry}
              onClose={() => setPersonDayModal(null)}
            />
          </motion.div>
        </motion.div>
      )}
      </AnimatePresence>

      {/* Entry Modal */}
      <AnimatePresence>
      {showModal && (
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeEditModal()
          }}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ duration: 0.25, delay: 0.1 }}
            className="bg-white rounded-2xl shadow-xl max-w-md w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <h2 className="text-xl font-bold text-primary-dark mb-1">
                {editingEntry ? 'Edit Time Entry' : 'Log Time'}
              </h2>
              {editingEntry && (
                <div className="mb-4">
                  <p className="text-sm text-primary-dark/70">
                    Entry for: <span className="font-medium text-primary-dark">{editingEntry.user.full_name || editingEntry.user.display_name || editingEntry.user.email.split('@')[0]}</span>
                  </p>
                  {editingEntry.locked_at && (
                    <div className="mt-2 flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-amber-700 text-sm">
                      <LockIcon />
                      <span>This entry is locked and cannot be edited.</span>
                    </div>
                  )}
                  {editingEntry.approved_by && (
                    <div className={`mt-2 px-3 py-2 rounded-lg text-sm border ${
                      editingEntry.approval_status === 'approved'
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                        : 'bg-red-50 border-red-200 text-red-700'
                    }`}>
                      <span className="font-medium">
                        {editingEntry.approval_status === 'approved' ? 'Approved' : 'Denied'}
                      </span>
                      {' '}by {editingEntry.approved_by.full_name}
                      {editingEntry.approval_note && (
                        <p className="mt-1 text-xs italic opacity-80">"{editingEntry.approval_note}"</p>
                      )}
                    </div>
                  )}
                </div>
              )}
              {!editingEntry && <div className="mb-4" />}
              
              <form onSubmit={handleSubmit} className="space-y-4">
              <fieldset disabled={!!(editingEntry?.locked_at)} className={editingEntry?.locked_at ? 'opacity-60' : ''}>
                {/* Date */}
                <div>
                  <label className="block text-sm font-medium text-primary-dark mb-1">
                    Date *
                  </label>
                  <input
                    type="date"
                    value={formData.work_date}
                    onChange={(e) => setFormData({ ...formData, work_date: e.target.value })}
                    className="w-full px-3 py-2 border border-neutral-warm rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                    required
                  />
                </div>

                {/* Time Range */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-primary-dark mb-1">
                      Start Time *
                    </label>
                    <input
                      type="time"
                      value={formData.start_time}
                      onChange={(e) => setFormData({ ...formData, start_time: e.target.value })}
                      className="w-full px-3 py-2 border border-neutral-warm rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-primary-dark mb-1">
                      End Time *
                    </label>
                    <input
                      type="time"
                      value={formData.end_time}
                      onChange={(e) => setFormData({ ...formData, end_time: e.target.value })}
                      className="w-full px-3 py-2 border border-neutral-warm rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                      required
                    />
                  </div>
                </div>
                
                {/* Calculated Hours Display */}
                <div className="bg-neutral-warm/30 rounded-lg p-3 flex items-center justify-between">
                  <span className="text-sm text-primary-dark">Calculated Hours:</span>
                  <span className="text-lg font-bold text-primary">{calculatedHours.toFixed(2)}h</span>
                </div>

                {/* Entry Owner (admin create only) */}
                {isAdmin && !editingEntry && (
                  <div>
                    <label className="block text-sm font-medium text-primary-dark mb-1">
                      Entry Owner
                    </label>
                    <select
                      value={formData.user_id}
                      onChange={(e) => setFormData({ ...formData, user_id: e.target.value })}
                      className="w-full px-3 py-2 border border-neutral-warm rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                    >
                      <option value="">Select user...</option>
                      {users.map(user => (
                        <option key={user.id} value={user.id}>
                          {(user.full_name || user.display_name || user.email)} ({user.role})
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Break Duration */}
                <div>
                  <label className="block text-sm font-medium text-primary-dark mb-1">
                    Break Duration
                  </label>
                  <div className="flex flex-wrap gap-2 mb-2">
                    {BREAK_PRESETS.map((preset) => (
                      <button
                        key={preset.label}
                        type="button"
                        onClick={() => {
                          if (preset.minutes === -1) {
                            // Custom - keep current value or set to empty for custom input
                            setFormData({ ...formData, break_minutes: formData.break_minutes || 0 })
                          } else {
                            setFormData({ ...formData, break_minutes: preset.minutes })
                          }
                        }}
                        className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                          (preset.minutes === null && formData.break_minutes === null) ||
                          (preset.minutes === formData.break_minutes) ||
                          (preset.minutes === -1 && formData.break_minutes !== null && !BREAK_PRESETS.slice(0, -1).some(p => p.minutes === formData.break_minutes))
                            ? 'bg-primary text-white'
                            : 'bg-neutral-warm text-primary-dark hover:bg-primary/20'
                        }`}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                  {/* Custom input - show when a value is set that's not a preset, or when Custom is selected */}
                  {formData.break_minutes !== null && !BREAK_PRESETS.slice(0, -1).some(p => p.minutes === formData.break_minutes) && (
                    <input
                      type="number"
                      min="0"
                      aria-label="Custom break duration in minutes"
                      max="480"
                      value={formData.break_minutes || ''}
                      onChange={(e) => setFormData({ ...formData, break_minutes: e.target.value ? parseInt(e.target.value) : null })}
                      placeholder="Minutes"
                      className="w-full px-3 py-2 border border-neutral-warm rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                    />
                  )}
                  <p className="text-xs text-text-muted mt-1">Break time is not counted toward work hours</p>
                </div>

                {/* Category */}
                <div>
                  <label className="block text-sm font-medium text-primary-dark mb-1">
                    Category
                  </label>
                  <select
                    value={formData.time_category_id}
                    onChange={(e) => setFormData({ ...formData, time_category_id: e.target.value })}
                    className="w-full px-3 py-2 border border-neutral-warm rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                  >
                    <option value="">Select category...</option>
                    {categories.map(cat => (
                      <option key={cat.id} value={cat.id}>{cat.name}</option>
                    ))}
                  </select>
                </div>

                {/* Description */}
                <div>
                  <label className="block text-sm font-medium text-primary-dark mb-1">
                    Description
                  </label>
                  <textarea
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    rows={3}
                    placeholder="What did you work on?"
                    className="w-full px-3 py-2 border border-neutral-warm rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent resize-none"
                  />
                </div>

              </fieldset>
                {/* Actions */}
                <div className="flex justify-between items-center gap-3 pt-4">
                  <div>
                    {editingEntry && (
                      <button
                        type="button"
                        onClick={() => handleDelete(editingEntry)}
                        disabled={!canDeleteEntry(editingEntry)}
                        className={`px-4 py-2 rounded-lg transition-colors ${canDeleteEntry(editingEntry) ? 'text-red-600 hover:bg-red-50' : 'text-gray-300 cursor-not-allowed'}`}
                        title={canDeleteEntry(editingEntry) ? 'Delete this time entry' : 'This entry is locked/finalized or cannot be deleted'}
                      >
                        Delete
                      </button>
                    )}
                  </div>

                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={closeEditModal}
                      className="px-4 py-2 text-primary-dark font-medium hover:bg-neutral-warm rounded-lg transition-colors"
                    >
                      Cancel
                    </button>
                    {!(editingEntry?.locked_at) && (
                      <button
                        type="submit"
                        disabled={saving}
                        className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary-dark transition-colors disabled:opacity-50"
                      >
                        {saving ? 'Saving...' : (editingEntry ? 'Update' : 'Save')}
                      </button>
                    )}
                  </div>
                </div>
              </form>
            </div>
          </motion.div>
        </motion.div>
      )}
      </AnimatePresence>
      </>
      )}

      {/* Reports Tab */}
      {activeTab === 'reports' && isAdmin && (
        <div className="space-y-6">
          {/* Report Filters */}
          <div className="bg-white rounded-2xl shadow-sm border border-neutral-warm p-4 hover:shadow-md transition-shadow duration-300">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
              <h3 className="text-sm font-medium text-primary-dark">Filter Report</h3>
              <div className="flex flex-wrap items-center gap-3">
                {aireCategories.length > 0 && aireCategories.length < categories.length && (
                  <label className="inline-flex items-center gap-2 text-sm text-text-muted">
                    <input
                      type="checkbox"
                      checked={reportFilters.aire_only}
                      onChange={(e) => setReportFilters({ ...reportFilters, aire_only: e.target.checked, time_category_id: e.target.checked ? '' : reportFilters.time_category_id })}
                      className="rounded border-neutral-warm text-primary focus:ring-primary"
                    />
                    AIRE categories only
                  </label>
                )}
                <button
                  onClick={exportHoursCsv}
                  disabled={reportLoading || hoursSummaryRows.length === 0}
                  className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary-dark disabled:opacity-50"
                >
                  Export Hours CSV
                </button>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div>
                <label className="block text-sm text-text-muted mb-1">Start Date</label>
                <input
                  type="date"
                  value={reportFilters.start_date}
                  onChange={(e) => setReportFilters({ ...reportFilters, start_date: e.target.value })}
                  className="w-full px-3 py-2 border border-neutral-warm rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              <div>
                <label className="block text-sm text-text-muted mb-1">End Date</label>
                <input
                  type="date"
                  value={reportFilters.end_date}
                  onChange={(e) => setReportFilters({ ...reportFilters, end_date: e.target.value })}
                  className="w-full px-3 py-2 border border-neutral-warm rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              {isAdmin && (
                <div>
                  <label className="block text-sm text-text-muted mb-1">Employee</label>
                  <select
                    value={reportFilters.user_id}
                    onChange={(e) => setReportFilters({ ...reportFilters, user_id: e.target.value })}
                    className="w-full px-3 py-2 border border-neutral-warm rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    <option value="">All Employees</option>
                    {users.map(user => (
                      <option key={user.id} value={user.id}>{user.display_name || user.email.split('@')[0]}</option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <label className="block text-sm text-text-muted mb-1">Category</label>
                <select
                  value={reportFilters.time_category_id}
                  onChange={(e) => setReportFilters({ ...reportFilters, time_category_id: e.target.value })}
                  className="w-full px-3 py-2 border border-neutral-warm rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="">{reportFilters.aire_only ? 'All AIRE Categories' : 'All Categories'}</option>
                  {(reportFilters.aire_only ? aireCategories : categories).map(cat => (
                    <option key={cat.id} value={cat.id}>{cat.name}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Summary Cards */}
          <StaggerContainer className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <StaggerItem>
              <div className="bg-white rounded-2xl shadow-sm border border-neutral-warm p-4 hover:shadow-md transition-shadow duration-300">
                <div className="text-sm text-text-muted">Work Hours</div>
                <div className="text-3xl font-bold text-primary mt-1">
                  {reportLoading ? '...' : reportSummary.total_hours.toFixed(1)}
                </div>
              </div>
            </StaggerItem>
            <StaggerItem>
              <div className="bg-white rounded-2xl shadow-sm border border-neutral-warm p-4 hover:shadow-md transition-shadow duration-300">
                <div className="text-sm text-text-muted">Break Hours</div>
                <div className="text-3xl font-bold text-text-muted mt-1">
                  {reportLoading ? '...' : reportSummary.total_break_hours.toFixed(1)}
                </div>
              </div>
            </StaggerItem>
            <StaggerItem>
              <div className="bg-white rounded-2xl shadow-sm border border-neutral-warm p-4 hover:shadow-md transition-shadow duration-300">
                <div className="text-sm text-text-muted">Total Entries</div>
                <div className="text-3xl font-bold text-primary-dark mt-1">
                  {reportLoading ? '...' : reportSummary.entry_count}
                </div>
              </div>
            </StaggerItem>
            <StaggerItem>
              <div className="bg-white rounded-2xl shadow-sm border border-neutral-warm p-4 hover:shadow-md transition-shadow duration-300">
                <div className="text-sm text-text-muted">Avg Hours/Entry</div>
                <div className="text-3xl font-bold text-text-muted mt-1">
                  {reportLoading ? '...' : (reportSummary.entry_count > 0 ? (reportSummary.total_hours / reportSummary.entry_count).toFixed(1) : '0')}
                </div>
              </div>
            </StaggerItem>
          </StaggerContainer>

          {reportTruncated && !reportLoading && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-start gap-3">
              <svg className="w-5 h-5 text-amber-500 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
              </svg>
              <div>
                <p className="text-sm font-medium text-amber-800">
                  Showing {reportData.length} of {reportSummary.entry_count} entries
                </p>
                <p className="text-xs text-amber-600 mt-0.5">
                  The detail table below is capped at 500 rows. Summary totals above reflect all {reportSummary.entry_count} entries. Narrow your date range or filters to see all rows.
                </p>
              </div>
            </div>
          )}

          {/* Hours Summary by Employee & Category */}
          <div className="bg-white rounded-2xl shadow-sm border border-neutral-warm overflow-hidden hover:shadow-md transition-shadow duration-300">
            <div className="px-4 py-3 border-b border-neutral-warm bg-neutral-warm/30 flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-primary-dark">Hours Summary</h3>
                <p className="text-xs text-text-muted mt-0.5">Grouped by employee and work category</p>
              </div>
              <div className="flex items-center gap-4 text-right">
                <div>
                  <div className="text-xs text-text-muted">Work Hours</div>
                  <div className="text-lg font-bold text-primary">{hoursSummaryTotal.toFixed(2)}</div>
                </div>
                {hoursSummaryBreakTotal > 0 && (
                  <div>
                    <div className="text-xs text-text-muted">Break Hours</div>
                    <div className="text-lg font-bold text-text-muted">{hoursSummaryBreakTotal.toFixed(2)}</div>
                  </div>
                )}
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-neutral-warm/40">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase">Employee</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase">Category</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-text-muted uppercase">Entries</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-text-muted uppercase">Work Hours</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-text-muted uppercase">Breaks</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-warm">
                  {reportLoading ? (
                    <tr><td colSpan={5} className="px-4 py-8 text-center text-text-muted">Loading...</td></tr>
                  ) : hoursSummaryRows.length === 0 ? (
                    <tr><td colSpan={5} className="px-4 py-8 text-center text-text-muted">No data for this range</td></tr>
                  ) : hoursSummaryRows.map((row) => (
                    <tr key={`${row.employeeName}-${row.categoryName}`} className="hover:bg-neutral-warm/20">
                      <td className="px-4 py-3 text-sm text-primary-dark">{row.employeeName}</td>
                      <td className="px-4 py-3 text-sm text-text-muted">{row.categoryName}</td>
                      <td className="px-4 py-3 text-sm text-right text-text-muted">{row.entries}</td>
                      <td className="px-4 py-3 text-sm text-right font-semibold text-primary-dark">{row.hours.toFixed(2)}</td>
                      <td className="px-4 py-3 text-sm text-right text-text-muted">{row.breakHours > 0 ? `${row.breakHours.toFixed(2)}` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Summary Tables */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* By Category */}
            <div className="bg-white rounded-2xl shadow-sm border border-neutral-warm overflow-hidden hover:shadow-md transition-shadow duration-300">
              <div className="px-4 py-3 border-b border-neutral-warm bg-neutral-warm/30">
                <h3 className="font-semibold text-primary-dark">Hours by Category</h3>
              </div>
              <div className="divide-y divide-neutral-warm">
                {reportLoading ? (
                  <div className="p-4 text-center text-text-muted">Loading...</div>
                ) : Object.entries(reportByCategory).length === 0 ? (
                  <div className="p-4 text-center text-text-muted">No data</div>
                ) : (
                  Object.entries(reportByCategory)
                    .sort((a, b) => b[1] - a[1])
                    .map(([name, hours]) => (
                      <div key={name} className="px-4 py-3 flex justify-between items-center">
                        <span className="text-primary-dark">{name}</span>
                        <span className="font-semibold text-primary">{hours.toFixed(1)}h</span>
                      </div>
                    ))
                )}
              </div>
            </div>

            {/* By Employee */}
            <div className="bg-white rounded-2xl shadow-sm border border-neutral-warm overflow-hidden hover:shadow-md transition-shadow duration-300">
              <div className="px-4 py-3 border-b border-neutral-warm bg-neutral-warm/30">
                <h3 className="font-semibold text-primary-dark">Hours by Employee</h3>
              </div>
              <div className="divide-y divide-neutral-warm">
                {reportLoading ? (
                  <div className="p-4 text-center text-text-muted">Loading...</div>
                ) : Object.entries(reportByUser).length === 0 ? (
                  <div className="p-4 text-center text-text-muted">No data</div>
                ) : (
                  Object.entries(reportByUser)
                    .sort((a, b) => b[1] - a[1])
                    .map(([email, hours]) => (
                      <div key={email} className="px-4 py-3 flex justify-between items-center">
                        <span className="text-primary-dark truncate max-w-[150px]">{email}</span>
                        <span className="font-semibold text-primary">{hours.toFixed(1)}h</span>
                      </div>
                    ))
                )}
              </div>
            </div>

            {/* By Source */}
            <div className="bg-white rounded-2xl shadow-sm border border-neutral-warm overflow-hidden hover:shadow-md transition-shadow duration-300">
              <div className="px-4 py-3 border-b border-neutral-warm bg-neutral-warm/30">
                <h3 className="font-semibold text-primary-dark">Hours by Source</h3>
              </div>
              <div className="divide-y divide-neutral-warm">
                {reportLoading ? (
                  <div className="p-4 text-center text-text-muted">Loading...</div>
                ) : Object.entries(reportBySource).length === 0 ? (
                  <div className="p-4 text-center text-text-muted">No data</div>
                ) : (
                  Object.entries(reportBySource)
                    .sort((a, b) => b[1] - a[1])
                    .map(([name, hours]) => (
                      <div key={name} className="px-4 py-3 flex justify-between items-center">
                        <span className="text-primary-dark uppercase">{name}</span>
                        <span className="font-semibold text-primary">{hours.toFixed(1)}h</span>
                      </div>
                    ))
                )}
              </div>
            </div>

          </div>

          {/* Detailed Entries Table */}
          <DetailedEntriesTable
            entries={reportData}
            isAdmin={isAdmin}
            loading={reportLoading}
          />
        </div>
      )}
    </div>
  )
}

function DetailedEntriesTable({
  entries,
  isAdmin,
  loading,
}: {
  entries: TimeEntryItem[]
  isAdmin: boolean
  loading: boolean
}) {
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set())

  const groups = entries.reduce((acc, entry) => {
    const name = entry.user.full_name || entry.user.display_name || entry.user.email.split('@')[0]
    const key = `${entry.work_date}__${entry.user.id}`
    if (!acc[key]) {
      acc[key] = { date: entry.work_date, userId: entry.user.id, name, entries: [] }
    }
    acc[key].entries.push(entry)
    return acc
  }, {} as Record<string, { date: string; userId: number; name: string; entries: TimeEntryItem[] }>)

  const groupList = Object.entries(groups)
    .sort(([, a], [, b]) => b.date.localeCompare(a.date) || a.name.localeCompare(b.name))

  const toggle = (key: string) => {
    setExpandedKeys(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const colCount = isAdmin ? 8 : 7

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-neutral-warm overflow-hidden hover:shadow-md transition-shadow duration-300">
      <div className="px-4 py-3 border-b border-neutral-warm bg-neutral-warm/30">
        <h3 className="font-semibold text-primary-dark">Detailed Entries</h3>
        <p className="text-xs text-text-muted mt-0.5">Grouped by employee per day — click to expand</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-neutral-warm/50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase">Date</th>
              {isAdmin && <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase">Employee</th>}
              <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase">Time</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase">Categories</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase">Source</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-text-muted uppercase">Hours</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-text-muted uppercase">Breaks</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase">Description</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-warm">
            {loading ? (
              <tr><td colSpan={colCount} className="px-4 py-8 text-center text-text-muted">Loading...</td></tr>
            ) : groupList.length === 0 ? (
              <tr><td colSpan={colCount} className="px-4 py-8 text-center text-text-muted">No entries found</td></tr>
            ) : (
              groupList.slice(0, 100).map(([key, group]) => {
                const isExpanded = expandedKeys.has(key)
                const totalHours = group.entries.reduce((s, e) => s + e.hours, 0)
                const totalBreaks = group.entries.reduce((s, e) => s + (e.break_minutes || 0), 0)
                const hasMultiple = group.entries.length > 1
                const cats = [...new Set(group.entries.map(e => e.time_category?.name || 'Other'))]
                const sources = [...new Set(group.entries.map(e => e.clock_source || 'legacy'))]
                const firstStart = group.entries[0].formatted_start_time
                const lastEnd = group.entries[group.entries.length - 1].formatted_end_time
                const descriptions = group.entries.map(e => e.description).filter(Boolean)

                return (
                  <Fragment key={key}>
                    <tr
                      className={`hover:bg-neutral-warm/20 ${hasMultiple ? 'cursor-pointer' : ''}`}
                      onClick={() => hasMultiple && toggle(key)}
                    >
                      <td className="px-4 py-3 text-sm text-primary-dark whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          {hasMultiple && (
                            <svg className={`w-3 h-3 text-text-muted transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                          )}
                          {formatDate(group.date)}
                        </div>
                      </td>
                      {isAdmin && <td className="px-4 py-3 text-sm text-text-muted">{group.name}</td>}
                      <td className="px-4 py-3 text-sm text-primary-dark whitespace-nowrap">
                        {firstStart && lastEnd ? `${firstStart} – ${lastEnd}` : '-'}
                      </td>
                      <td className="px-4 py-3 text-sm text-text-muted">
                        {hasMultiple ? (
                          <div className="flex flex-wrap gap-1">
                            {cats.map(c => (
                              <span key={c} className="inline-block bg-secondary/60 text-primary-dark rounded px-1.5 py-0.5 text-[10px] font-medium">{c}</span>
                            ))}
                          </div>
                        ) : cats[0]}
                      </td>
                      <td className="px-4 py-3 text-sm text-text-muted uppercase">{sources.join(', ')}</td>
                      <td className="px-4 py-3 text-sm text-primary font-semibold text-right">
                        {totalHours.toFixed(2)}
                        {hasMultiple && <span className="text-[10px] text-text-muted font-normal ml-1">({group.entries.length})</span>}
                      </td>
                      <td className="px-4 py-3 text-sm text-text-muted text-right">{totalBreaks > 0 ? `${totalBreaks}m` : '—'}</td>
                      <td className="px-4 py-3 text-sm text-text-muted truncate max-w-[200px]">{descriptions.length > 0 ? descriptions.join('; ') : '-'}</td>
                    </tr>
                    {isExpanded && group.entries.map(entry => (
                      <tr key={entry.id} className="bg-secondary/30">
                        <td className="pl-10 pr-4 py-2 text-xs text-text-muted whitespace-nowrap"></td>
                        {isAdmin && <td className="px-4 py-2 text-xs text-text-muted"></td>}
                        <td className="px-4 py-2 text-xs text-primary-dark whitespace-nowrap">
                          {entry.formatted_start_time && entry.formatted_end_time
                            ? `${entry.formatted_start_time} – ${entry.formatted_end_time}`
                            : '-'}
                        </td>
                        <td className="px-4 py-2 text-xs text-text-muted">{entry.time_category?.name || '-'}</td>
                        <td className="px-4 py-2 text-xs text-text-muted uppercase">{entry.clock_source || 'legacy'}</td>
                        <td className="px-4 py-2 text-xs text-primary font-semibold text-right">{entry.hours.toFixed(2)}</td>
                        <td className="px-4 py-2 text-xs text-text-muted text-right">{entry.break_minutes ? `${entry.break_minutes}m` : '—'}</td>
                        <td className="px-4 py-2 text-xs text-text-muted truncate max-w-[200px]">{entry.description || '-'}</td>
                      </tr>
                    ))}
                  </Fragment>
                )
              })
            )}
          </tbody>
        </table>
        {groupList.length > 100 && (
          <div className="px-4 py-3 text-center text-sm text-text-muted border-t border-neutral-warm">
            Showing first 100 groups of {groupList.length} total
          </div>
        )}
      </div>
    </div>
  )
}

function CalendarUserGroup({
  entries,
  name,
  totalHours,
  firstStart,
  lastEnd,
  hasLocked,
  hasPending,
  hasDenied,
  onClick,
}: {
  entries: TimeEntryItem[]
  name: string
  totalHours: number
  firstStart: string | null
  lastEnd: string | null
  hasLocked: boolean
  hasPending: boolean
  hasDenied: boolean
  onClick: () => void
}) {
  const catSummary = entries.reduce((acc, e) => {
    const cat = e.time_category?.name || 'Other'
    acc[cat] = (acc[cat] || 0) + e.hours
    return acc
  }, {} as Record<string, number>)

  return (
    <div
      className={`mb-1 sm:mb-2 border rounded text-xs shadow-sm cursor-pointer hover:shadow-md transition-all ${hasLocked ? 'border-amber-300 bg-amber-50/30' : 'border-neutral-warm bg-white hover:border-primary/40'}`}
      onClick={onClick}
    >
      <div className="p-1 sm:p-2">
        <div className="font-bold text-primary-dark flex items-center gap-1">
          <ClockIcon />
          {totalHours.toFixed(2)}h
          {hasPending && <span className="w-2 h-2 rounded-full bg-amber-500" title="Has pending entries" />}
          {hasDenied && <span className="w-2 h-2 rounded-full bg-red-500" title="Has denied entries" />}
          <span className="ml-auto text-[9px] font-normal text-primary/60">{entries.length} entries</span>
        </div>
        {firstStart && lastEnd && (
          <div className="text-primary-dark/70 text-[10px]">{firstStart} – {lastEnd}</div>
        )}
        <div className="mt-0.5 space-y-0">
          {Object.entries(catSummary).map(([cat, hrs]) => (
            <div key={cat} className="flex items-center justify-between text-[10px]">
              <span className="text-primary font-medium truncate mr-1">{cat}</span>
              <span className="text-text-muted shrink-0">{hrs.toFixed(2)}h</span>
            </div>
          ))}
        </div>
        <div className="text-primary-dark/70 truncate text-[10px] mt-0.5">{name}</div>
      </div>
    </div>
  )
}

function PersonDayModalContent({
  entries,
  name,
  dateLabel,
  isLocked,
  onEditEntry,
  onAddEntry,
  onDeleteEntry,
  canDelete,
  onClose,
}: {
  entries: TimeEntryItem[]
  name: string
  dateLabel: string
  isLocked: boolean
  onEditEntry: (e: TimeEntryItem) => void
  onAddEntry: () => void
  onDeleteEntry: (e: TimeEntryItem) => void
  canDelete: (e: TimeEntryItem) => boolean
  onClose: () => void
}) {
  const totalHours = entries.reduce((s, e) => s + e.hours, 0)
  const totalBreaks = entries.reduce((s, e) => s + (e.break_minutes || 0), 0)
  const sorted = [...entries].sort((a, b) => {
    const ta = a.start_time || ''
    const tb = b.start_time || ''
    return ta.localeCompare(tb)
  })

  const catSummary = entries.reduce((acc, e) => {
    const cat = e.time_category?.name || 'Other'
    acc[cat] = (acc[cat] || 0) + e.hours
    return acc
  }, {} as Record<string, number>)

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-start justify-between mb-5">
        <div>
          <h2 className="text-xl font-bold text-primary-dark">{name}</h2>
          <p className="text-sm text-text-muted">{dateLabel}</p>
        </div>
        <button
          onClick={onClose}
          className="p-1 text-text-muted hover:text-primary-dark rounded-lg hover:bg-neutral-warm transition-colors"
          title="Close"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        <div className="bg-primary/10 rounded-xl p-3 text-center">
          <div className="text-lg font-bold text-primary">{totalHours.toFixed(2)}h</div>
          <div className="text-xs text-text-muted">Total Hours</div>
        </div>
        <div className="bg-neutral-warm/50 rounded-xl p-3 text-center">
          <div className="text-lg font-bold text-primary-dark">{entries.length}</div>
          <div className="text-xs text-text-muted">{entries.length === 1 ? 'Entry' : 'Entries'}</div>
        </div>
        <div className="bg-amber-50 rounded-xl p-3 text-center">
          <div className="text-lg font-bold text-amber-700">{totalBreaks > 0 ? `${totalBreaks}m` : '—'}</div>
          <div className="text-xs text-text-muted">Breaks</div>
        </div>
      </div>

      {/* Category breakdown pills */}
      {Object.keys(catSummary).length > 1 && (
        <div className="flex flex-wrap gap-2 mb-5">
          {Object.entries(catSummary).map(([cat, hrs]) => (
            <span key={cat} className="inline-flex items-center gap-1 px-3 py-1 bg-primary/10 text-primary text-sm font-medium rounded-full">
              {cat}
              <span className="text-primary/60">{hrs.toFixed(2)}h</span>
            </span>
          ))}
        </div>
      )}

      {/* Entries list */}
      <div className="space-y-2 mb-5">
        {sorted.map((entry, idx) => {
          const prevEntry = idx > 0 ? sorted[idx - 1] : null
          const isCategorySwitch = prevEntry && entry.time_category?.id !== prevEntry.time_category?.id

          return (
            <Fragment key={entry.id}>
              {isCategorySwitch && (
                <div className="flex items-center gap-2 px-2 py-1">
                  <div className="flex-1 h-px bg-cyan-300" />
                  <span className="text-[10px] text-cyan-600 font-medium flex items-center gap-1">
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" /></svg>
                    Switched category
                  </span>
                  <div className="flex-1 h-px bg-cyan-300" />
                </div>
              )}
              <div
                className={`border rounded-xl p-3 transition-all ${
                  entry.locked_at
                    ? 'border-amber-200 bg-amber-50/30'
                    : 'border-neutral-warm hover:border-primary/40 hover:shadow-sm cursor-pointer'
                }`}
                onClick={() => !entry.locked_at && onEditEntry(entry)}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    {/* Time range */}
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-semibold text-primary-dark">
                        {entry.formatted_start_time || '—'} – {entry.formatted_end_time || 'Active'}
                      </span>
                      {entry.status === 'clocked_in' && (
                        <span className="px-1.5 py-0.5 bg-emerald-100 text-emerald-700 text-[10px] font-medium rounded-full">Active</span>
                      )}
                      {entry.status === 'on_break' && (
                        <span className="px-1.5 py-0.5 bg-amber-100 text-amber-700 text-[10px] font-medium rounded-full">On Break</span>
                      )}
                    </div>

                    {/* Category */}
                    <div className="flex items-center gap-2 mb-1">
                      {entry.time_category ? (
                        <span className="inline-flex items-center px-2 py-0.5 bg-primary/10 text-primary text-xs font-medium rounded-full">
                          {entry.time_category.name}
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 bg-neutral-warm text-text-muted text-xs rounded-full">
                          No category
                        </span>
                      )}
                      {entry.clock_source && (
                        <span className="text-[10px] text-text-muted uppercase tracking-wide">{entry.clock_source}</span>
                      )}
                    </div>

                    {/* Details row */}
                    <div className="flex items-center gap-3 text-xs text-text-muted">
                      <span className="font-medium text-primary-dark">{entry.hours.toFixed(2)}h</span>
                      {(entry.break_minutes ?? 0) > 0 && (
                        <span>{entry.break_minutes}m break</span>
                      )}
                      {entry.description && (
                        <span className="truncate max-w-[200px]" title={entry.description}>{entry.description}</span>
                      )}
                    </div>

                    {/* Status indicators */}
                    <div className="flex items-center gap-2 mt-1">
                      {entry.approval_status === 'pending' && (
                        <span className="inline-flex items-center gap-1 text-[10px] text-amber-600">
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                          Pending approval
                        </span>
                      )}
                      {entry.approval_status === 'approved' && entry.approved_by && (
                        <span className="inline-flex items-center gap-1 text-[10px] text-emerald-600">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                          Approved by {entry.approved_by.full_name}
                        </span>
                      )}
                      {entry.approval_status === 'denied' && (
                        <span className="inline-flex items-center gap-1 text-[10px] text-red-600">
                          <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                          Denied
                        </span>
                      )}
                      {entry.locked_at && (
                        <span className="inline-flex items-center gap-1 text-[10px] text-amber-600">
                          <LockIcon />
                          Locked
                        </span>
                      )}
                      {entry.admin_override && (
                        <span className="inline-flex items-center gap-1 text-[10px] text-indigo-500">Admin override</span>
                      )}
                    </div>
                  </div>

                  {/* Action buttons */}
                  <div className="flex flex-col gap-1 shrink-0">
                    <button
                      onClick={(e) => { e.stopPropagation(); onEditEntry(entry) }}
                      disabled={!!entry.locked_at}
                      className={`p-1.5 rounded-lg transition-colors ${entry.locked_at ? 'text-gray-300 cursor-not-allowed' : 'text-primary-dark hover:text-primary hover:bg-neutral-warm'}`}
                      title={entry.locked_at ? 'Locked' : 'Edit entry'}
                    >
                      <EditIcon />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); onDeleteEntry(entry) }}
                      disabled={!canDelete(entry)}
                      className={`p-1.5 rounded-lg transition-colors ${!canDelete(entry) ? 'text-gray-300 cursor-not-allowed' : 'text-primary-dark hover:text-red-600 hover:bg-red-50'}`}
                      title={!canDelete(entry) ? 'Cannot delete' : 'Delete entry'}
                    >
                      <TrashIcon />
                    </button>
                  </div>
                </div>
              </div>
            </Fragment>
          )
        })}
      </div>

      {/* Footer actions */}
      <div className="flex justify-between items-center pt-3 border-t border-neutral-warm">
        {!isLocked ? (
          <button
            onClick={onAddEntry}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-primary hover:text-primary-dark hover:bg-primary/10 rounded-lg transition-colors"
          >
            <PlusIcon />
            Add Entry
          </button>
        ) : (
          <span className="inline-flex items-center gap-1 text-xs text-amber-600">
            <LockIcon /> This period is locked
          </span>
        )}
        <button
          onClick={onClose}
          className="px-4 py-2 text-sm font-medium text-primary-dark hover:bg-neutral-warm rounded-lg transition-colors"
        >
          Close
        </button>
      </div>
    </div>
  )
}
