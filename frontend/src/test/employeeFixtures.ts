import type { ClockStatus, TimeCategory, TimeEntry } from '../lib/api'

export const categories = [
  { id: 1, name: 'Flight Instruction' },
  { id: 2, name: 'Ground School' },
] as TimeCategory[]

export const shift = (extra: Partial<TimeEntry> = {}): TimeEntry => {
  const entry: TimeEntry = {
  id: 41,
  version: 2,
  work_date: '2026-11-14',
  start_time: '08:00',
  end_time: '11:00',
  formatted_start_time: '8:00 AM',
  formatted_end_time: '11:00 AM',
  hours: 3,
  break_minutes: 0,
  description: null,
  entry_method: 'clock',
  clock_source: 'mobile',
  status: 'completed',
  admin_override: false,
  attendance_status: null,
  approval_status: 'pending',
  overtime_status: 'none',
  clock_in_at: '2026-11-14T08:00:00+10:00',
  clock_out_at: '2026-11-14T11:00:00+10:00',
  approved_by: null,
  approved_at: null,
  approval_note: null,
  overtime_approved_by: null,
  overtime_approved_at: null,
  overtime_note: null,
  schedule: null,
  breaks: [],
  user: {
    id: 5,
    email: 'employee@aire.test',
    full_name: 'Ethan Cruz',
    display_name: 'Ethan Cruz',
  },
  time_category: { id: 2, name: 'Ground School' },
  created_at: '2026-11-14T08:00:00+10:00',
  updated_at: '2026-11-14T11:00:00+10:00',
  ...extra,
  }
  const approved = entry.status === 'completed' && entry.approval_status !== 'denied' && (entry.approval_status === 'approved' || (entry.entry_method === 'clock' && entry.approval_status === null))
  const waiting = entry.status === 'completed' && entry.approval_status !== 'denied' && !approved
  const overtimeWaiting = approved ? entry.pending_overtime_hours ?? 0 : 0
  entry.payroll_hours_by_date ??= [{ work_date: entry.work_date, approved_hours: approved ? entry.hours - overtimeWaiting : 0, approved_regular_hours: approved ? entry.hours - overtimeWaiting : 0, approved_overtime_hours: 0, time_waiting_hours: waiting ? entry.hours : 0, overtime_waiting_hours: overtimeWaiting }]
  return entry
}

export const clockStatus = (extra: Partial<ClockStatus> = {}): ClockStatus => ({
  clocked_in: false,
  status: null,
  entry_id: null,
  clock_in_at: null,
  elapsed_minutes: null,
  break_minutes: 0,
  active_break: false,
  active_break_started_at: null,
  breaks: [],
  schedule: null,
  can_clock_in: true,
  time_tracking_enabled: true,
  clock_in_blocked_reason: null,
  clock_in_location_required: false,
  ...extra,
})
