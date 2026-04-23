// AIRE Services API client

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3100';

interface ApiResponse<T> {
  data?: T;
  error?: string;
  errors?: string[];
}

let getAuthToken: (() => Promise<string | null>) | null = null;

export function setAuthTokenGetter(getter: () => Promise<string | null>) {
  getAuthToken = getter;
}

export function getAuthTokenValue(): Promise<string | null> {
  return getAuthToken ? getAuthToken() : Promise.resolve(null);
}

async function fetchApi<T>(
  endpoint: string,
  options: RequestInit = {},
  requireAuth: boolean = true
): Promise<ApiResponse<T>> {
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    };

    if (requireAuth && getAuthToken) {
      const token = await getAuthToken();
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
    }

    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      ...options,
      headers,
    });

    if (response.status === 204) {
      return { data: undefined as unknown as T };
    }

    let data;
    const responseText = await response.text();
    try {
      data = responseText ? JSON.parse(responseText) : null;
    } catch {
      console.error('API Error: Failed to parse response as JSON', {
        status: response.status,
        body: responseText.substring(0, 200),
      });
      return {
        error: `Server returned an invalid response (${response.status})`,
        errors: ['The server may be temporarily unavailable. Please try again.'],
      };
    }

    if (data === null && !responseText) {
      return {
        error: `Server returned an empty response (${response.status})`,
        errors: ['The server may be temporarily unavailable. Please try again.'],
      };
    }

    if (!response.ok) {
      if (response.status === 401) {
        return {
          error: data.error || 'Authentication required',
          errors: data.errors || ['Please sign in to continue'],
        };
      }
      if (response.status === 403) {
        return {
          error: data.error || 'Access denied',
          errors: data.errors || ['You do not have permission to perform this action'],
        };
      }
      return {
        error: data.error || 'Something went wrong',
        errors: data.errors || [],
      };
    }

    return { data };
  } catch (error) {
    console.error('API Error:', error);
    return {
      error: error instanceof Error ? error.message : 'Network error',
      errors: [],
    };
  }
}

async function fetchApiPublic<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<ApiResponse<T>> {
  return fetchApi(endpoint, options, false);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CurrentUser {
  id: number;
  email: string;
  first_name: string | null;
  last_name: string | null;
  full_name: string;
  role: 'admin' | 'employee';
  approval_group?: ApprovalGroup | null;
  is_active: boolean;
  is_admin: boolean;
  is_staff: boolean;
  kiosk_enabled: boolean;
  kiosk_pin_configured: boolean;
  kiosk_pin_last_rotated_at?: string | null;
  needs_kiosk_pin_setup: boolean;
  created_at: string;
}

export type ApprovalGroup = 'cfi' | 'ops_maintenance';
export type ApprovalGroupFilter = ApprovalGroup | 'unassigned';

export interface UserSummary {
  id: number;
  email: string;
  first_name: string | null;
  last_name: string | null;
  display_name: string;
  full_name: string;
  role: string;
  approval_group?: ApprovalGroup | null;
  approval_group_label?: string;
}

export interface UserTimeCategoryAssignment {
  id: number;
  name: string;
  key: string | null;
}

export interface AdminUser {
  id: number;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  display_name: string;
  full_name: string;
  role: 'admin' | 'employee';
  approval_group?: ApprovalGroup | null;
  approval_group_label?: string;
  is_active: boolean;
  is_pending: boolean;
  uses_clerk_profile: boolean;
  kiosk_enabled?: boolean;
  kiosk_pin_configured?: boolean;
  kiosk_pin_last_rotated_at?: string | null;
  kiosk_locked_until?: string | null;
  time_category_ids?: number[];
  time_categories?: UserTimeCategoryAssignment[];
  created_at: string;
  updated_at: string;
}

export interface ResetKioskPinResponse {
  user: AdminUser;
  kiosk_pin: string;
  message: string;
}

// Time Tracking Types

export interface TimeCategory {
  id: number;
  key?: string | null;
  name: string;
  description: string | null;
}

export interface AdminTimeCategory extends TimeCategory {
  is_active: boolean;
  time_entries_count: number;
  created_at: string;
  updated_at: string;
}

/** Payload for admin create/update (nested under `time_category` in the request body). */
export interface AdminTimeCategoryInput {
  name: string;
  key?: string | null;
  description?: string | null;
  is_active?: boolean;
}

export interface TimeClockAppSettings {
  overtime_daily_threshold_hours: string;
  overtime_weekly_threshold_hours: string;
  early_clock_in_buffer_minutes: string;
}

export interface ContactSettings {
  contact_notification_emails: string[];
  inquiry_topics: string[];
}

export interface PublicContactSettings {
  inquiry_topics: string[];
}

export interface TimeEntry {
  id: number;
  work_date: string;
  start_time: string | null;
  end_time: string | null;
  formatted_start_time: string | null;
  formatted_end_time: string | null;
  hours: number;
  break_minutes: number | null;
  description: string | null;
  entry_method: 'clock' | 'manual';
  clock_source?: 'kiosk' | 'mobile' | 'admin' | 'legacy' | null;
  status: 'clocked_in' | 'on_break' | 'completed';
  admin_override: boolean;
  attendance_status: 'early' | 'on_time' | 'late' | null;
  approval_status: 'pending' | 'approved' | 'denied' | null;
  overtime_status: 'none' | 'pending' | 'approved' | 'denied' | null;
  clock_in_at: string | null;
  clock_out_at: string | null;
  approved_by: {
    id: number;
    full_name: string;
  } | null;
  approved_at: string | null;
  approval_note: string | null;
  overtime_approved_by: {
    id: number;
    full_name: string;
  } | null;
  overtime_approved_at: string | null;
  overtime_note: string | null;
  schedule: {
    id: number;
    start_time: string;
    end_time: string;
  } | null;
  breaks: Array<{
    id: number;
    start_time: string;
    end_time: string | null;
    duration_minutes: number | null;
    active: boolean;
  }>;
  user: {
    id: number;
    email: string;
    display_name: string;
    full_name: string;
    approval_group?: ApprovalGroup | null;
    approval_group_label?: string;
  };
  time_category: {
    id: number;
    key?: string | null;
    name: string;
  } | null;
  locked_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ClockSessionSegment {
  category_name: string;
  clock_in_at: string;
  clock_out_at: string | null;
  active: boolean;
}

export interface ClockSession {
  original_clock_in_at: string;
  total_break_minutes: number;
  completed_work_seconds: number;
  segments: ClockSessionSegment[];
}

export interface ClockStatus {
  clocked_in: boolean;
  status: 'clocked_in' | 'on_break' | 'completed' | null;
  entry_id: number | null;
  clock_in_at: string | null;
  elapsed_minutes: number | null;
  break_minutes: number;
  active_break: boolean;
  active_break_started_at: string | null;
  breaks: Array<{
    start_time: string;
    end_time: string | null;
    duration_minutes: number | null;
    active: boolean;
  }>;
  session?: ClockSession | null;
  schedule: {
    id: number;
    start_time: string;
    end_time: string;
    hours: number;
  } | null;
  can_clock_in: boolean;
  clock_in_blocked_reason: 'already_clocked_in' | 'too_early' | 'shift_ended' | null;
  minutes_until?: number;
  is_admin?: boolean;
  clock_source?: 'kiosk' | 'mobile' | 'admin' | 'legacy' | null;
  time_category?: {
    id: number;
    key?: string | null;
    name: string;
  } | null;
}

export interface AireKioskEmployee {
  id: number;
  display_name: string;
  full_name: string;
}

export interface AireKioskVerifyResponse {
  employee: AireKioskEmployee;
  kiosk_token: string;
  current_status: ClockStatus;
  available_categories: TimeCategory[];
}

export interface AireKioskActionResponse {
  employee: AireKioskEmployee;
  time_entry: TimeEntry;
  current_status: ClockStatus;
  available_categories: TimeCategory[];
}

export interface WorkerBreak {
  start_time: string;
  end_time: string | null;
  duration_minutes: number | null;
  active: boolean;
}

export interface WorkerDayEntry {
  id: number;
  status: string;
  clock_in_at: string | null;
  clock_out_at: string | null;
  hours: number;
  clock_source?: string | null;
  time_category?: {
    id: number;
    key?: string | null;
    name: string;
  } | null;
  breaks: WorkerBreak[];
}

export interface WorkerStatus {
  user: {
    id: number;
    full_name: string;
    display_name: string;
    email: string;
  };
  schedule: {
    start_time: string;
    end_time: string;
    hours: number;
  } | null;
  status: string;
  clock_in_at: string | null;
  clock_out_at: string | null;
  clock_source?: 'kiosk' | 'mobile' | 'admin' | 'legacy' | null;
  completed_hours: number;
  active_break: boolean;
  break_started_at: string | null;
  total_break_minutes: number;
  breaks: WorkerBreak[];
  time_category?: {
    id: number;
    key?: string | null;
    name: string;
  } | null;
  day_entries?: WorkerDayEntry[];
}

export interface TimeEntriesResponse {
  time_entries: TimeEntry[];
  pagination: {
    current_page: number;
    per_page: number;
    total_count: number;
    total_pages: number;
    truncated?: boolean;
  };
  summary: {
    total_hours: number;
    total_break_hours: number;
    entry_count: number;
  };
}

export interface TimePeriodLock {
  id: number;
  start_date: string;
  end_date: string;
  locked_at: string;
  reason: string | null;
  locked_by: {
    id: number;
    full_name: string;
    email: string;
  };
}

export interface TimePeriodLockStatusResponse {
  week_start: string;
  week_end: string;
  locked: boolean;
  lock: TimePeriodLock | null;
}

// Schedule Types

export interface Schedule {
  id: number;
  user_id: number;
  user: {
    id: number;
    email: string;
    display_name: string;
    full_name: string;
  };
  work_date: string;
  start_time: string;
  end_time: string;
  formatted_start_time: string;
  formatted_end_time: string;
  formatted_time_range: string;
  hours: number;
  notes: string | null;
  created_by: {
    id: number;
    email: string;
  } | null;
  created_at: string;
  updated_at: string;
}

export interface SchedulesResponse {
  schedules: Schedule[];
  users: Array<{
    id: number;
    email: string;
    display_name: string;
    full_name: string;
  }>;
}

export interface ScheduleTimePreset {
  id: number;
  label: string;
  start_time: string;
  end_time: string;
  formatted_start_time: string;
  formatted_end_time: string;
  position: number;
  active: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface ScheduleTimePresetsResponse {
  presets: ScheduleTimePreset[];
}

// ---------------------------------------------------------------------------
// API methods
// ---------------------------------------------------------------------------

export const api = {
  // Auth
  getCurrentUser: () =>
    fetchApi<{ user: CurrentUser }>('/api/v1/auth/me', {
      method: 'POST',
    }),

  setMyKioskPin: (pin: string) =>
    fetchApi<{ user: CurrentUser; message: string }>('/api/v1/auth/kiosk_pin', {
      method: 'POST',
      body: JSON.stringify({ pin }),
    }),

  // Contact form (public)
  getPublicContactSettings: () =>
    fetchApiPublic<PublicContactSettings>('/api/v1/contact_settings'),

  submitContact: (data: { name: string; email: string; phone?: string; subject: string; message: string }) =>
    fetchApiPublic<{ success: boolean; message: string }>('/api/v1/contact', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  // AIRE Kiosk (public, PIN-based auth)
  aireKioskVerify: (pin: string) =>
    fetchApi<AireKioskVerifyResponse>('/api/v1/aire/kiosk/verify', {
      method: 'POST',
      body: JSON.stringify({ pin }),
    }),

  aireKioskClockIn: (kioskToken: string, timeCategoryId?: number | null) =>
    fetchApi<AireKioskActionResponse>('/api/v1/aire/kiosk/clock_in', {
      method: 'POST',
      body: JSON.stringify({
        kiosk_token: kioskToken,
        ...(timeCategoryId ? { time_category_id: timeCategoryId } : {}),
      }),
    }),

  aireKioskClockOut: (kioskToken: string) =>
    fetchApi<AireKioskActionResponse>('/api/v1/aire/kiosk/clock_out', {
      method: 'POST',
      body: JSON.stringify({ kiosk_token: kioskToken }),
    }),

  aireKioskStartBreak: (kioskToken: string) =>
    fetchApi<AireKioskActionResponse>('/api/v1/aire/kiosk/start_break', {
      method: 'POST',
      body: JSON.stringify({ kiosk_token: kioskToken }),
    }),

  aireKioskEndBreak: (kioskToken: string) =>
    fetchApi<AireKioskActionResponse>('/api/v1/aire/kiosk/end_break', {
      method: 'POST',
      body: JSON.stringify({ kiosk_token: kioskToken }),
    }),

  aireKioskSwitchCategory: (kioskToken: string, timeCategoryId: number) =>
    fetchApi<AireKioskActionResponse>('/api/v1/aire/kiosk/switch_category', {
      method: 'POST',
      body: JSON.stringify({ kiosk_token: kioskToken, time_category_id: timeCategoryId }),
    }),

  // Users (staff list for dropdowns)
  getUsers: () =>
    fetchApi<{ users: UserSummary[] }>('/api/v1/users'),

  // Admin: User Management
  getAdminUsers: () =>
    fetchApi<{ users: AdminUser[] }>('/api/v1/admin/users'),

  inviteUser: (data: {
    email?: string;
    first_name?: string;
    last_name?: string;
    role: 'admin' | 'employee';
    approval_group?: ApprovalGroup | null;
    send_invitation?: boolean;
    time_category_ids?: number[];
  }) =>
    fetchApi<{ user: AdminUser; invitation_email_sent: boolean }>('/api/v1/admin/users', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateUserRole: (id: number, role: 'admin' | 'employee') =>
    fetchApi<{ user: AdminUser }>(`/api/v1/admin/users/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ role }),
    }),

  updateUser: (id: number, data: {
    first_name?: string;
    last_name?: string;
    email?: string | null;
    role?: 'admin' | 'employee';
    approval_group?: ApprovalGroup | null;
    is_active?: boolean;
    time_category_ids?: number[];
  }) =>
    fetchApi<{ user: AdminUser }>(`/api/v1/admin/users/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  deleteUser: (id: number) =>
    fetchApi<void>(`/api/v1/admin/users/${id}`, {
      method: 'DELETE',
    }),

  resendInvite: (id: number) =>
    fetchApi<{ message: string }>(`/api/v1/admin/users/${id}/resend_invite`, {
      method: 'POST',
    }),

  resetKioskPin: (id: number, pin?: string) =>
    fetchApi<ResetKioskPinResponse>(`/api/v1/admin/users/${id}/reset_kiosk_pin`, {
      method: 'POST',
      ...(pin ? { body: JSON.stringify({ pin }) } : {}),
    }),

  // Time Entries
  getTimeEntries: (params?: {
    page?: number;
    per_page?: number;
    date?: string;
    week?: string;
    start_date?: string;
    end_date?: string;
    time_category_id?: number;
    user_id?: number;
    exclude_approval_statuses?: string[];
  }) => {
    const searchParams = new URLSearchParams();
    if (params?.page) searchParams.set('page', params.page.toString());
    if (params?.per_page) searchParams.set('per_page', params.per_page.toString());
    if (params?.date) searchParams.set('date', params.date);
    if (params?.week) searchParams.set('week', params.week);
    if (params?.start_date) searchParams.set('start_date', params.start_date);
    if (params?.end_date) searchParams.set('end_date', params.end_date);
    if (params?.time_category_id) searchParams.set('time_category_id', params.time_category_id.toString());
    if (params?.user_id) searchParams.set('user_id', params.user_id.toString());
    if (params?.exclude_approval_statuses) {
      params.exclude_approval_statuses.forEach(s => searchParams.append('exclude_approval_statuses[]', s));
    }
    const query = searchParams.toString();
    return fetchApi<TimeEntriesResponse>(`/api/v1/time_entries${query ? `?${query}` : ''}`);
  },

  createTimeEntry: (data: {
    work_date: string;
    start_time: string;
    end_time: string;
    description?: string;
    time_category_id?: number;
    break_minutes?: number | null;
    user_id?: number;
  }) =>
    fetchApi<{ time_entry: TimeEntry }>('/api/v1/time_entries', {
      method: 'POST',
      body: JSON.stringify({ time_entry: data }),
    }),

  updateTimeEntry: (id: number, data: Partial<{
    work_date: string;
    start_time: string;
    end_time: string;
    description: string;
    time_category_id: number;
    break_minutes: number | null;
  }>) =>
    fetchApi<{ time_entry: TimeEntry }>(`/api/v1/time_entries/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ time_entry: data }),
    }),

  deleteTimeEntry: (id: number) =>
    fetchApi<void>(`/api/v1/time_entries/${id}`, {
      method: 'DELETE',
    }),

  // Time Clock
  clockIn: (userId?: number, adminOverride?: boolean, timeCategoryId?: number) =>
    fetchApi<{ time_entry: TimeEntry }>('/api/v1/time_entries/clock_in', {
      method: 'POST',
      body: JSON.stringify({
        ...(userId ? { user_id: userId } : {}),
        ...(adminOverride ? { admin_override: true } : {}),
        ...(timeCategoryId ? { time_category_id: timeCategoryId } : {}),
      }),
    }),

  clockOut: (correctedEndTime?: string, description?: string, userId?: number) =>
    fetchApi<{ time_entry: TimeEntry }>('/api/v1/time_entries/clock_out', {
      method: 'POST',
      body: JSON.stringify({
        ...(userId ? { user_id: userId } : {}),
        ...(correctedEndTime ? { corrected_end_time: correctedEndTime } : {}),
        ...(description ? { description } : {}),
      }),
    }),

  startBreak: (userId?: number) =>
    fetchApi<{ time_entry: TimeEntry }>('/api/v1/time_entries/start_break', {
      method: 'POST',
      ...(userId ? { body: JSON.stringify({ user_id: userId }) } : {}),
    }),

  endBreak: (userId?: number) =>
    fetchApi<{ time_entry: TimeEntry }>('/api/v1/time_entries/end_break', {
      method: 'POST',
      ...(userId ? { body: JSON.stringify({ user_id: userId }) } : {}),
    }),

  switchCategory: (timeCategoryId: number, userId?: number) =>
    fetchApi<{ time_entry: TimeEntry }>('/api/v1/time_entries/switch_category', {
      method: 'POST',
      body: JSON.stringify({
        time_category_id: timeCategoryId,
        ...(userId ? { user_id: userId } : {}),
      }),
    }),

  getClockStatus: () =>
    fetchApi<ClockStatus>('/api/v1/time_entries/current_status'),

  getPendingApprovals: (approvalGroup?: ApprovalGroupFilter) => {
    const query = approvalGroup ? `?approval_group=${encodeURIComponent(approvalGroup)}` : '';
    return fetchApi<{ pending_entries: TimeEntry[]; count: number }>(`/api/v1/time_entries/pending_approvals${query}`);
  },

  getWhosWorking: () =>
    fetchApi<{ workers: WorkerStatus[] }>('/api/v1/time_entries/whos_working'),

  approveTimeEntry: (id: number, note?: string) =>
    fetchApi<{ time_entry: TimeEntry }>(`/api/v1/time_entries/${id}/approve`, {
      method: 'POST',
      body: JSON.stringify({ note }),
    }),

  bulkApproveTimeEntries: (entryIds: number[], note?: string) =>
    fetchApi<{ time_entries: TimeEntry[]; count: number }>('/api/v1/time_entries/bulk_approve', {
      method: 'POST',
      body: JSON.stringify({ entry_ids: entryIds, ...(note ? { note } : {}) }),
    }),

  denyTimeEntry: (id: number, note?: string) =>
    fetchApi<{ time_entry: TimeEntry }>(`/api/v1/time_entries/${id}/deny`, {
      method: 'POST',
      body: JSON.stringify({ note }),
    }),

  approveOvertime: (id: number, note?: string) =>
    fetchApi<{ time_entry: TimeEntry }>(`/api/v1/time_entries/${id}/approve_overtime`, {
      method: 'POST',
      body: JSON.stringify({ note }),
    }),

  denyOvertime: (id: number, note?: string) =>
    fetchApi<{ time_entry: TimeEntry }>(`/api/v1/time_entries/${id}/deny_overtime`, {
      method: 'POST',
      body: JSON.stringify({ note }),
    }),

  // Time Categories
  getTimeCategories: () =>
    fetchApi<{ time_categories: TimeCategory[] }>('/api/v1/time_categories'),

  getAdminTimeCategories: () =>
    fetchApi<{ time_categories: AdminTimeCategory[] }>('/api/v1/admin/time_categories'),

  getAdminAppSettings: () =>
    fetchApi<{ settings: TimeClockAppSettings }>('/api/v1/admin/settings'),

  updateAdminAppSettings: (settings: Partial<TimeClockAppSettings>) =>
    fetchApi<{ settings: TimeClockAppSettings }>('/api/v1/admin/settings', {
      method: 'PATCH',
      body: JSON.stringify({ settings }),
    }),

  getAdminContactSettings: () =>
    fetchApi<ContactSettings>('/api/v1/admin/contact_settings'),

  updateAdminContactSettings: (settings: ContactSettings) =>
    fetchApi<ContactSettings & { message: string }>('/api/v1/admin/contact_settings', {
      method: 'PATCH',
      body: JSON.stringify(settings),
    }),

  createTimeCategory: (data: AdminTimeCategoryInput) =>
    fetchApi<{ time_category: AdminTimeCategory }>('/api/v1/admin/time_categories', {
      method: 'POST',
      body: JSON.stringify({ time_category: data }),
    }),

  updateTimeCategory: (id: number, data: Partial<AdminTimeCategoryInput>) =>
    fetchApi<{ time_category: AdminTimeCategory }>(`/api/v1/admin/time_categories/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ time_category: data }),
    }),

  deleteTimeCategory: (id: number) =>
    fetchApi<void>(`/api/v1/admin/time_categories/${id}`, {
      method: 'DELETE',
    }),

  // Time Period Locks
  getTimePeriodLockStatus: (week: string) =>
    fetchApi<TimePeriodLockStatusResponse>(`/api/v1/time_period_locks?week=${encodeURIComponent(week)}`),

  lockTimePeriod: (week: string, reason?: string) =>
    fetchApi<{ lock: TimePeriodLock; message: string }>('/api/v1/admin/time_period_locks', {
      method: 'POST',
      body: JSON.stringify({ week, reason }),
    }),

  unlockTimePeriod: (id: number) =>
    fetchApi<{ message: string }>(`/api/v1/admin/time_period_locks/${id}`, {
      method: 'DELETE',
    }),

  // Schedules
  getSchedules: (params?: {
    week?: string;
    start_date?: string;
    end_date?: string;
    user_id?: number;
  }) => {
    const searchParams = new URLSearchParams();
    if (params?.week) searchParams.set('week', params.week);
    if (params?.start_date) searchParams.set('start_date', params.start_date);
    if (params?.end_date) searchParams.set('end_date', params.end_date);
    if (params?.user_id) searchParams.set('user_id', params.user_id.toString());
    const query = searchParams.toString();
    return fetchApi<SchedulesResponse>(`/api/v1/schedules${query ? `?${query}` : ''}`);
  },

  getMySchedule: () =>
    fetchApi<{ schedules: Schedule[] }>('/api/v1/schedules/my_schedule'),

  createSchedule: (data: {
    user_id: number;
    work_date: string;
    start_time: string;
    end_time: string;
    notes?: string;
  }) =>
    fetchApi<{ schedule: Schedule }>('/api/v1/schedules', {
      method: 'POST',
      body: JSON.stringify({ schedule: data }),
    }),

  bulkCreateSchedules: (schedules: Array<{
    user_id: number;
    work_date: string;
    start_time: string;
    end_time: string;
    notes?: string;
  }>) =>
    fetchApi<{ schedules: Schedule[] }>('/api/v1/schedules/bulk_create', {
      method: 'POST',
      body: JSON.stringify({ schedules }),
    }),

  updateSchedule: (id: number, data: Partial<{
    user_id: number;
    work_date: string;
    start_time: string;
    end_time: string;
    notes: string;
  }>) =>
    fetchApi<{ schedule: Schedule }>(`/api/v1/schedules/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ schedule: data }),
    }),

  deleteSchedule: (id: number) =>
    fetchApi<void>(`/api/v1/schedules/${id}`, {
      method: 'DELETE',
    }),

  clearWeekSchedules: (week: string, userId?: number) => {
    const searchParams = new URLSearchParams();
    searchParams.set('week', week);
    if (userId) searchParams.set('user_id', userId.toString());
    return fetchApi<{ message: string }>(`/api/v1/schedules/clear_week?${searchParams.toString()}`, {
      method: 'DELETE',
    });
  },

  // Schedule Time Presets
  getScheduleTimePresets: () =>
    fetchApi<ScheduleTimePresetsResponse>('/api/v1/schedule_time_presets'),
};
