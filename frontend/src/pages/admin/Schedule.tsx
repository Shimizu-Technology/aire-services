import { useState, useEffect, useCallback } from 'react'
import { FadeUp } from '../../components/ui/MotionComponents'
import { AnimatePresence, motion } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { api } from '../../lib/api'
import { formatDateISO } from '../../lib/dateUtils'
import type { Schedule as ScheduleType, ScheduleTimePreset } from '../../lib/api'

interface UserOption {
  id: number
  email: string
  display_name?: string
  full_name?: string
}

// Fallback presets in case API fails
const DEFAULT_PRESETS = [
  { label: '8-1', start_time: '08:00', end_time: '13:00' },
  { label: '8-5', start_time: '08:00', end_time: '17:00' },
  { label: '8:30-5', start_time: '08:30', end_time: '17:00' },
  { label: '9-5', start_time: '09:00', end_time: '17:00' },
  { label: '12:30-5', start_time: '12:30', end_time: '17:00' },
  { label: '1-5', start_time: '13:00', end_time: '17:00' },
]

type ViewMode = 'grid' | 'list'

// Helper functions
function getWeekStart(date: Date): Date {
  const d = new Date(date)
  const day = d.getDay()
  d.setDate(d.getDate() - day) // Start on Sunday
  return d
}

function getWeekDates(weekStart: Date): Date[] {
  const dates: Date[] = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart)
    d.setDate(weekStart.getDate() + i)
    dates.push(d)
  }
  return dates
}

function formatDayHeader(date: Date): string {
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

function formatDayLong(date: Date): string {
  return date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
}

export default function Schedule() {
  useEffect(() => { document.title = 'Schedule | AIRE Ops' }, [])

  const navigate = useNavigate()
  const [schedules, setSchedules] = useState<ScheduleType[]>([])
  const [users, setUsers] = useState<UserOption[]>([])
  const [timePresets, setTimePresets] = useState<Array<{ label: string; start_time: string; end_time: string }>>(DEFAULT_PRESETS)
  const [loading, setLoading] = useState(true)
  const [currentWeekStart, setCurrentWeekStart] = useState(() => getWeekStart(new Date()))
  const [viewMode, setViewMode] = useState<ViewMode>('list')
  const [teamFilter, setTeamFilter] = useState('')
  
  // Modal state
  const [showModal, setShowModal] = useState(false)
  const [editingSchedule, setEditingSchedule] = useState<ScheduleType | null>(null)
  const [selectedCell, setSelectedCell] = useState<{ userId: number; date: string } | null>(null)
  const [formData, setFormData] = useState({
    user_id: 0,
    work_date: '',
    start_time: '08:30',
    end_time: '17:00',
    notes: '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const weekDates = getWeekDates(currentWeekStart)
  const normalizedTeamFilter = teamFilter.trim().toLowerCase()
  const visibleUsers = normalizedTeamFilter
    ? users.filter((user) => {
        const label = `${user.display_name || ''} ${user.full_name || ''} ${user.email}`.toLowerCase()
        return label.includes(normalizedTeamFilter)
      })
    : users
  const visibleUserIds = new Set(visibleUsers.map((user) => user.id))
  const visibleSchedules = schedules.filter((schedule) => visibleUserIds.has(schedule.user_id))

  const loadSchedules = useCallback(async () => {
    setLoading(true)
    try {
      const response = await api.getSchedules({
        week: formatDateISO(currentWeekStart),
      })
      if (response.data) {
        setSchedules(response.data.schedules)
        setUsers(response.data.users)
      }
    } catch (err) {
      console.error('Failed to load schedules:', err)
    } finally {
      setLoading(false)
    }
  }, [currentWeekStart])

  const loadPresets = useCallback(async () => {
    try {
      const response = await api.getScheduleTimePresets()
      if (response.data && response.data.presets.length > 0) {
        setTimePresets(response.data.presets.map((p: ScheduleTimePreset) => ({
          label: p.label,
          start_time: p.start_time,
          end_time: p.end_time,
        })))
      }
    } catch (err) {
      console.error('Failed to load presets, using defaults:', err)
    }
  }, [])

  useEffect(() => {
    loadSchedules()
  }, [loadSchedules])

  useEffect(() => {
    loadPresets()
  }, [loadPresets])

  // Navigation
  const goToPrevWeek = () => {
    const newStart = new Date(currentWeekStart)
    newStart.setDate(newStart.getDate() - 7)
    setCurrentWeekStart(newStart)
  }

  const goToNextWeek = () => {
    const newStart = new Date(currentWeekStart)
    newStart.setDate(newStart.getDate() + 7)
    setCurrentWeekStart(newStart)
  }

  const goToCurrentWeek = () => {
    setCurrentWeekStart(getWeekStart(new Date()))
  }

  // Get schedules for a specific user and date
  const getSchedulesForCell = (userId: number, date: Date): ScheduleType[] => {
    const dateStr = formatDateISO(date)
    return visibleSchedules.filter(s => s.user_id === userId && s.work_date === dateStr)
  }

  // Group schedules by date for list view
  const getSchedulesByDate = (): Map<string, ScheduleType[]> => {
    const byDate = new Map<string, ScheduleType[]>()
    weekDates.forEach(date => {
      const dateStr = formatDateISO(date)
      const daySchedules = visibleSchedules.filter(s => s.work_date === dateStr)
      if (daySchedules.length > 0) {
        byDate.set(dateStr, daySchedules)
      }
    })
    return byDate
  }

  // Open modal to add new schedule
  const openAddModal = (userId: number, date: string) => {
    setEditingSchedule(null)
    setSelectedCell({ userId, date })
    setFormData({
      user_id: userId,
      work_date: date,
      start_time: '08:30',
      end_time: '17:00',
      notes: '',
    })
    setShowModal(true)
    setError(null)
  }

  // Open modal to edit existing schedule
  const openEditModal = (schedule: ScheduleType) => {
    setEditingSchedule(schedule)
    setSelectedCell(null)
    setFormData({
      user_id: schedule.user_id,
      work_date: schedule.work_date,
      start_time: schedule.start_time,
      end_time: schedule.end_time,
      notes: schedule.notes || '',
    })
    setShowModal(true)
    setError(null)
  }

  // Apply time preset
  const applyPreset = (preset: { label: string; start_time: string; end_time: string }) => {
    setFormData(prev => ({
      ...prev,
      start_time: preset.start_time,
      end_time: preset.end_time,
    }))
  }

  // Save schedule
  const handleSave = async () => {
    setSaving(true)
    setError(null)

    try {
      if (editingSchedule) {
        const response = await api.updateSchedule(editingSchedule.id, formData)
        if (response.error) {
          setError(response.error)
          return
        }
      } else {
        const response = await api.createSchedule(formData)
        if (response.error) {
          setError(response.error)
          return
        }
      }
      setShowModal(false)
      loadSchedules()
    } catch {
      setError('Failed to save schedule')
    } finally {
      setSaving(false)
    }
  }

  // Delete schedule
  const handleDelete = async () => {
    if (!editingSchedule) return
    if (!confirm('Are you sure you want to delete this shift?')) return

    try {
      await api.deleteSchedule(editingSchedule.id)
      setShowModal(false)
      loadSchedules()
    } catch {
      setError('Failed to delete schedule')
    }
  }

  // Log shift as time entry - navigate to time tracking with pre-filled data
  const handleLogShift = (schedule: ScheduleType) => {
    // Navigate to time tracking with start/end times from schedule
    const notes = `Scheduled shift: ${schedule.formatted_time_range}`
    navigate(`/admin/time?prefill=true&date=${schedule.work_date}&start_time=${schedule.start_time}&end_time=${schedule.end_time}&notes=${encodeURIComponent(notes)}`)
  }

  // Get user display name (first name or email prefix)
  const getUserDisplayName = (user: UserOption | undefined) => {
    if (!user) return 'Unknown'
    return user.display_name || user.email.split('@')[0]
  }

  // Get user by ID
  const getUserById = (userId: number): UserOption | undefined => {
    return users.find(u => u.id === userId)
  }

  // Calculate weekly hours for a user
  const getWeeklyHours = (userId: number): number => {
    return visibleSchedules
      .filter(s => s.user_id === userId)
      .reduce((sum, s) => sum + s.hours, 0)
  }

  // Calculate total scheduled hours for the week
  const getTotalWeeklyHours = (): number => {
    return visibleSchedules.reduce((sum, s) => sum + s.hours, 0)
  }

  const scheduledStaffCount = visibleUsers.filter((user) => getWeeklyHours(user.id) > 0).length
  const totalShifts = visibleSchedules.length
  const avgHoursPerScheduledStaff = scheduledStaffCount > 0 ? getTotalWeeklyHours() / scheduledStaffCount : 0

  return (
    <div className="space-y-6">
      {/* Header */}
      <FadeUp>
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-primary-dark tracking-tight">Employee Schedule</h1>
          <p className="text-text-muted mt-1">Plan shifts, review staffing coverage, and move directly into time tracking when schedules turn into actual work.</p>
        </div>
        
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <input
            value={teamFilter}
            onChange={(e) => setTeamFilter(e.target.value)}
            placeholder="Filter by team member"
            className="w-full rounded-xl border border-neutral-warm px-4 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 sm:w-64"
          />

        {/* View Mode Toggle */}
        <div className="flex items-center gap-1 bg-neutral-warm rounded-lg p-1">
          <button
            onClick={() => setViewMode('list')}
            className={`px-4 py-2.5 sm:py-2 text-sm font-medium rounded-md transition-colors min-h-[44px] sm:min-h-0 ${
              viewMode === 'list'
                ? 'bg-white text-primary shadow-sm'
                : 'text-text-muted hover:text-primary-dark'
            }`}
          >
            <span className="flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" aria-hidden="true" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
              </svg>
              <span className="hidden sm:inline">List</span>
            </span>
          </button>
          <button
            onClick={() => setViewMode('grid')}
            className={`px-4 py-2.5 sm:py-2 text-sm font-medium rounded-md transition-colors min-h-[44px] sm:min-h-0 ${
              viewMode === 'grid'
                ? 'bg-white text-primary shadow-sm'
                : 'text-text-muted hover:text-primary-dark'
            }`}
          >
            <span className="flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" aria-hidden="true" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
              </svg>
              <span className="hidden sm:inline">Grid</span>
            </span>
          </button>
        </div>
        </div>
      </div>
      </FadeUp>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl border border-neutral-warm bg-white p-4 shadow-sm">
          <div className="text-sm text-text-muted">Scheduled Hours</div>
          <div className="mt-2 text-3xl font-bold text-primary-dark">{getTotalWeeklyHours().toFixed(1)}h</div>
          <div className="mt-2 text-sm text-text-muted">Visible week total for the current staffing view</div>
        </div>
        <div className="rounded-2xl border border-neutral-warm bg-white p-4 shadow-sm">
          <div className="text-sm text-text-muted">Scheduled Staff</div>
          <div className="mt-2 text-3xl font-bold text-primary">{scheduledStaffCount}</div>
          <div className="mt-2 text-sm text-text-muted">Team members with at least one assigned shift this week</div>
        </div>
        <div className="rounded-2xl border border-neutral-warm bg-white p-4 shadow-sm">
          <div className="text-sm text-text-muted">Assigned Shifts</div>
          <div className="mt-2 text-3xl font-bold text-primary-dark">{totalShifts}</div>
          <div className="mt-2 text-sm text-text-muted">Shift blocks currently scheduled in the visible view</div>
        </div>
        <div className="rounded-2xl border border-neutral-warm bg-white p-4 shadow-sm">
          <div className="text-sm text-text-muted">Avg Hours / Staff</div>
          <div className="mt-2 text-3xl font-bold text-primary">{avgHoursPerScheduledStaff.toFixed(1)}h</div>
          <div className="mt-2 text-sm text-text-muted">Useful for spotting overloaded or underused staffing weeks</div>
        </div>
      </div>

      {/* Week Navigation */}
      <div className="bg-white rounded-2xl shadow-sm border border-neutral-warm p-3 sm:p-4 hover:shadow-md transition-shadow duration-300">
        <div className="flex items-center justify-between gap-2">
          <button
            onClick={goToPrevWeek}
            className="p-3 sm:p-2 hover:bg-neutral-warm rounded-lg transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
            aria-label="Previous week"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" aria-hidden="true" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          
          <div className="text-center flex-1 min-w-0">
            <div className="font-semibold text-primary-dark text-sm sm:text-base">
              {weekDates[0].toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - {weekDates[6].toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            </div>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-4">
              <button
                onClick={goToCurrentWeek}
                className="text-sm text-primary hover:text-primary-dark py-1"
              >
                Go to current week
              </button>
              {visibleSchedules.length > 0 && (
                <span className="text-xs sm:text-sm text-text-muted">
                  {getTotalWeeklyHours().toFixed(1)}h scheduled
                </span>
              )}
            </div>
          </div>

          <button
            onClick={goToNextWeek}
            className="p-3 sm:p-2 hover:bg-neutral-warm rounded-lg transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
            aria-label="Next week"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" aria-hidden="true" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>

      {/* Content based on view mode */}
      {loading ? (
        <div className="bg-white rounded-2xl shadow-sm border border-neutral-warm p-12 text-center">
          <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full mx-auto" />
        </div>
      ) : viewMode === 'list' ? (
        /* List View */
        <div className="space-y-4">
          {visibleSchedules.length === 0 ? (
            <div className="bg-white rounded-2xl shadow-sm border border-neutral-warm p-12 text-center">
              <div className="w-16 h-16 bg-secondary rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" aria-hidden="true" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </div>
              <p className="text-text-muted mb-4">No shifts scheduled this week</p>
              <button
                onClick={() => setViewMode('grid')}
                className="text-primary hover:text-primary-dark font-medium"
              >
                Switch to Grid View to add shifts
              </button>
            </div>
          ) : (
            Array.from(getSchedulesByDate().entries()).map(([dateStr, daySchedules]) => {
              const date = new Date(dateStr + 'T00:00:00')
              const isToday = dateStr === formatDateISO(new Date())
              
              return (
                <div key={dateStr} className="bg-white rounded-2xl shadow-sm border border-neutral-warm overflow-hidden hover:shadow-md transition-shadow duration-300">
                  <div className={`px-5 py-3 border-b border-neutral-warm ${isToday ? 'bg-primary/10' : 'bg-secondary/50'}`}>
                    <div className="flex items-center justify-between">
                      <h3 className={`font-semibold ${isToday ? 'text-primary' : 'text-primary-dark'}`}>
                        {formatDayLong(date)}
                        {isToday && <span className="ml-2 text-xs bg-primary text-white px-2 py-0.5 rounded-full">Today</span>}
                      </h3>
                      <span className="text-sm text-text-muted">
                        {daySchedules.reduce((sum, s) => sum + s.hours, 0).toFixed(1)}h total
                      </span>
                    </div>
                  </div>
                  <div className="divide-y divide-neutral-warm">
                    {daySchedules.map(schedule => {
                      const user = getUserById(schedule.user_id)
                      return (
                        <div key={schedule.id} className="px-4 sm:px-5 py-4 hover:bg-secondary/20 transition-colors">
                          {/* Mobile: Stack layout, Desktop: Row layout */}
                          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4">
                            {/* Employee info */}
                            <div className="flex items-center gap-3 sm:gap-4">
                              <div className="w-10 h-10 sm:w-10 sm:h-10 bg-primary/10 rounded-full flex items-center justify-center flex-shrink-0">
                                <span className="font-semibold text-primary text-sm sm:text-base">
                                  {getUserDisplayName(user).charAt(0).toUpperCase()}
                                </span>
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="font-medium text-primary-dark truncate">
                                  {getUserDisplayName(user)}
                                </p>
                                <p className="text-sm text-text-muted">
                                  {schedule.formatted_time_range}
                                  <span className="font-semibold text-primary-dark ml-2">({schedule.hours.toFixed(1)}h)</span>
                                  {schedule.notes && <span className="ml-2 text-primary hidden sm:inline">• {schedule.notes}</span>}
                                </p>
                                {schedule.notes && (
                                  <p className="text-sm text-primary sm:hidden mt-0.5">{schedule.notes}</p>
                                )}
                              </div>
                            </div>
                            
                            {/* Actions - larger touch targets on mobile */}
                            <div className="flex items-center gap-2 sm:gap-3 ml-13 sm:ml-0">
                              <button
                                onClick={() => handleLogShift(schedule)}
                                className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 px-3 py-2.5 sm:py-2 bg-primary/10 hover:bg-primary/20 text-primary text-sm font-medium rounded-lg transition-colors min-h-[44px] sm:min-h-0"
                                title="Log this shift as a time entry"
                              >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" aria-hidden="true" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                                <span>Log Time</span>
                              </button>
                              <button
                                onClick={() => openEditModal(schedule)}
                                className="inline-flex items-center justify-center p-2.5 sm:p-2 text-text-muted hover:text-primary-dark hover:bg-neutral-warm rounded-lg transition-colors min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0"
                                title="Edit shift"
                              >
                                <svg className="w-5 h-5 sm:w-4 sm:h-4" fill="none" stroke="currentColor" aria-hidden="true" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                                </svg>
                              </button>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })
          )}
        </div>
      ) : (
        /* Grid View */
        <div className="bg-white rounded-2xl shadow-sm border border-neutral-warm overflow-hidden hover:shadow-md transition-shadow duration-300">
          {visibleUsers.length === 0 ? (
            <div className="p-12 text-center">
              <p className="text-text-muted">No employees found</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[800px]">
                <thead>
                  <tr className="bg-secondary/50 border-b border-neutral-warm">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-primary-dark uppercase tracking-wide w-36">
                      Employee
                    </th>
                    {weekDates.map((date, idx) => {
                      const isToday = formatDateISO(date) === formatDateISO(new Date())
                      const isWeekend = idx === 0 || idx === 6
                      return (
                        <th
                          key={idx}
                          className={`px-2 py-3 text-center text-xs font-semibold uppercase tracking-wide min-w-[100px] ${
                            isToday ? 'bg-primary/10 text-primary' : isWeekend ? 'bg-neutral-warm/50 text-text-muted' : 'text-primary-dark'
                          }`}
                        >
                          {formatDayHeader(date)}
                        </th>
                      )
                    })}
                    <th className="px-4 py-3 text-center text-xs font-semibold text-primary-dark uppercase tracking-wide w-20">
                      Hours
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-warm">
                  {visibleUsers.map(user => (
                    <tr key={user.id} className="hover:bg-secondary/20 transition-colors">
                      <td className="px-4 py-3">
                        <div className="font-medium text-primary-dark text-sm">
                          {getUserDisplayName(user)}
                        </div>
                      </td>
                      {weekDates.map((date, idx) => {
                        const dateStr = formatDateISO(date)
                        const cellSchedules = getSchedulesForCell(user.id, date)
                        const isToday = dateStr === formatDateISO(new Date())
                        const isWeekend = idx === 0 || idx === 6
                        
                        return (
                          <td
                            key={idx}
                            className={`px-2 py-2 text-center ${
                              isToday ? 'bg-primary/5' : isWeekend ? 'bg-neutral-warm/30' : ''
                            }`}
                          >
                            <div className="space-y-1">
                              {/* Existing shifts */}
                              {cellSchedules.map(schedule => (
                                <button
                                  key={schedule.id}
                                  onClick={() => openEditModal(schedule)}
                                  className="w-full px-2 py-1.5 bg-primary/20 hover:bg-primary/30 text-primary text-xs font-medium rounded transition-colors"
                                >
                                  {schedule.formatted_time_range.replace(' AM', 'a').replace(' PM', 'p').replace(' - ', '-')}
                                </button>
                              ))}
                              {/* Always show Add button */}
                              <button
                                onClick={() => openAddModal(user.id, dateStr)}
                                className={`w-full px-2 py-1.5 border-2 border-dashed border-neutral-warm hover:border-primary hover:bg-primary/5 text-text-muted hover:text-primary text-xs rounded transition-colors ${
                                  cellSchedules.length > 0 ? 'opacity-60 hover:opacity-100' : ''
                                }`}
                              >
                                + Add
                              </button>
                            </div>
                          </td>
                        )
                      })}
                      <td className="px-4 py-3 text-center">
                        <span className="font-semibold text-primary-dark">
                          {getWeeklyHours(user.id).toFixed(1)}h
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Add/Edit Modal */}
      <AnimatePresence>
      {showModal && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowModal(false)
          }}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ duration: 0.25, delay: 0.1 }}
            className="bg-white rounded-2xl shadow-xl max-w-md w-full">
            <div className="p-6">
              <h2 className="text-xl font-bold text-primary-dark mb-4">
                {editingSchedule ? 'Edit Shift' : 'Add Shift'}
              </h2>

              {error && (
                <div className="mb-4 p-3 bg-red-50 text-red-600 rounded-lg text-sm">
                  {error}
                </div>
              )}

              <div className="space-y-4">
                {/* Employee (read-only when adding from cell) */}
                <div>
                  <label className="block text-sm font-medium text-primary-dark mb-1">
                    Employee
                  </label>
                  <select
                    value={formData.user_id}
                    onChange={(e) => setFormData({ ...formData, user_id: parseInt(e.target.value) })}
                    className="w-full px-3 py-2 border border-neutral-warm rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
                    disabled={!!selectedCell}
                  >
                    {users.map(user => (
                      <option key={user.id} value={user.id}>
                        {getUserDisplayName(user)}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Date */}
                <div>
                  <label className="block text-sm font-medium text-primary-dark mb-1">
                    Date
                  </label>
                  <input
                    type="date"
                    value={formData.work_date}
                    onChange={(e) => setFormData({ ...formData, work_date: e.target.value })}
                    className="w-full px-3 py-2 border border-neutral-warm rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
                  />
                </div>

                {/* Quick Presets */}
                <div>
                  <label className="block text-sm font-medium text-primary-dark mb-2">
                    Quick Times
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {timePresets.map(preset => (
                      <button
                        key={preset.label}
                        type="button"
                        onClick={() => applyPreset(preset)}
                        className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                          formData.start_time === preset.start_time && formData.end_time === preset.end_time
                            ? 'bg-primary text-white'
                            : 'bg-neutral-warm text-primary-dark hover:bg-primary/20'
                        }`}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Custom Times */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-primary-dark mb-1">
                      Start Time
                    </label>
                    <input
                      type="time"
                      value={formData.start_time}
                      onChange={(e) => setFormData({ ...formData, start_time: e.target.value })}
                      className="w-full px-3 py-2 border border-neutral-warm rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-primary-dark mb-1">
                      End Time
                    </label>
                    <input
                      type="time"
                      value={formData.end_time}
                      onChange={(e) => setFormData({ ...formData, end_time: e.target.value })}
                      className="w-full px-3 py-2 border border-neutral-warm rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
                    />
                  </div>
                </div>

                {/* Notes */}
                <div>
                  <label className="block text-sm font-medium text-primary-dark mb-1">
                    Notes (optional)
                  </label>
                  <input
                    type="text"
                    value={formData.notes}
                    onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                    placeholder="e.g., Remote, Training, etc."
                    className="w-full px-3 py-2 border border-neutral-warm rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
                  />
                </div>
              </div>

              {/* Actions */}
              <div className="flex justify-between mt-6 pt-4 border-t border-neutral-warm">
                <div>
                  {editingSchedule && (
                    <button
                      type="button"
                      onClick={handleDelete}
                      className="px-4 py-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors font-medium"
                    >
                      Delete
                    </button>
                  )}
                </div>
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => setShowModal(false)}
                    className="px-4 py-2 text-primary-dark font-medium hover:bg-neutral-warm rounded-lg transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={saving}
                    className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary-dark transition-colors disabled:opacity-50 font-medium"
                  >
                    {saving ? 'Saving...' : 'Save'}
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
      </AnimatePresence>
    </div>
  )
}
