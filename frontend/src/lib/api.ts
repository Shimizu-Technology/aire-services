import type { ConnectedPayrollCapability } from './connectedPayroll'
// AIRE Services API client
import type { PublicContactInfoSettings } from './businessInfo'
import { apiUrl } from './apiBase'
import type { Capabilities, UserRole } from './roles'

export interface InvitationEmailOutcome {
  invitation_email_sent?: boolean | null;
  invitation_email_captured?: boolean;
  invitation_email_queued?: boolean;
}

interface ApiResponse<T> {
  data?: T;
  error?: string;
  errors?: string[];
  status?: number;
  code?: string;
  export_references?: string[];
  approved_leave?: ApprovedLeaveAvailability[];
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

    const response = await fetch(apiUrl(endpoint), {
      ...options,
      headers,
    });

    if (response.status === 204) {
      return { data: undefined as unknown as T, status: response.status };
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
        status: response.status,
      };
    }

    if (data === null && !responseText) {
      return {
        error: `Server returned an empty response (${response.status})`,
        errors: ['The server may be temporarily unavailable. Please try again.'],
        status: response.status,
      };
    }

    if (!response.ok) {
      if (response.status === 401) {
        return {
          error: data.error || 'Authentication required',
          errors: data.errors || ['Please sign in to continue'],
          status: response.status,
        };
      }
      if (response.status === 403) {
        return {
          error: data.error || 'Access denied',
          errors: data.errors || ['You do not have permission to perform this action'],
          status: response.status,
        };
      }
      return {
        error: data.error || 'Something went wrong',
        errors: data.errors || [],
        status: response.status,
        code: data.code,
        export_references: data.export_references,
        approved_leave: data.approved_leave,
      };
    }

    return { data, status: response.status };
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

export interface DownloadResponse {
  blob?: Blob;
  filename?: string;
  error?: string;
  code?: string;
  issues?: Record<string, number>;
  status?: number;
}

export type HoursReportDownloadType = 'pdf' | 'timesheet_pdf' | 'detailed_csv' | 'summary_csv';

async function fetchDownload(endpoint: string): Promise<DownloadResponse> {
  try {
    const headers: Record<string, string> = {};
    if (getAuthToken) {
      const token = await getAuthToken();
      if (token) headers.Authorization = `Bearer ${token}`;
    }

    const response = await fetch(apiUrl(endpoint), { headers });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      return {
        error: data.error || 'Unable to download report',
        code: data.code,
        issues: data.issues,
        status: response.status,
      };
    }

    const disposition = response.headers.get('Content-Disposition') || '';
    const encodedFilename = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
    const plainFilename = disposition.match(/filename="?([^";]+)"?/i)?.[1];
    return {
      blob: await response.blob(),
      filename: encodedFilename ? decodeURIComponent(encodedFilename) : plainFilename || 'AIRE_Report',
      status: response.status,
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Network error' };
  }
}

async function fetchApiUpload<T>(
  endpoint: string,
  formData: FormData,
  options: RequestInit = {},
  requireAuth: boolean = true
): Promise<ApiResponse<T>> {
  try {
    const headers: Record<string, string> = {
      ...(options.headers as Record<string, string>),
    };

    if (requireAuth && getAuthToken) {
      const token = await getAuthToken();
      if (token) headers.Authorization = `Bearer ${token}`;
    }

    const response = await fetch(apiUrl(endpoint), {
      ...options,
      method: options.method || 'POST',
      headers,
      body: formData,
    });

    if (response.status === 204) return { data: undefined as unknown as T };

    const responseText = await response.text();
    let data;
    try {
      data = responseText ? JSON.parse(responseText) : null;
    } catch {
      console.error('Upload API Error: Failed to parse response as JSON', {
        status: response.status,
        body: responseText.substring(0, 200),
      });
      return {
        error: `Server returned an invalid response (${response.status})`,
        errors: ['The server may be temporarily unavailable. Please try again.'],
      };
    }

    if (!response.ok) {
      return {
        error: data?.error || 'Something went wrong',
        errors: data?.errors || [],
      };
    }

    return { data };
  } catch (error) {
    console.error('Upload API Error:', error);
    return {
      error: error instanceof Error ? error.message : 'Upload failed',
      errors: [],
    };
  }
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
  role: UserRole;
  is_intern?: boolean;
  approval_group?: ApprovalGroup | null;
  is_active: boolean;
  /** Owner or admin. */
  is_admin: boolean;
  is_owner?: boolean;
  is_staff: boolean;
  capabilities?: Capabilities;
  personal_access_enabled: boolean;
  profile_source: 'clerk' | 'local';
  time_tracking_enabled: boolean;
  kiosk_enabled: boolean;
  kiosk_pin_configured: boolean;
  kiosk_pin_last_rotated_at?: string | null;
  needs_kiosk_pin_setup: boolean;
  my_pay_enabled?: boolean;
  /** Owners and admins: may preview any worker's My Pay, read-only. */
  my_pay_preview_enabled?: boolean;
  /** My Pay is on and "Workers can email themselves stubs" is on in Settings. */
  my_pay_email_enabled?: boolean;
  /** "Use schedules" is on in Settings: Schedule shows in the navigation. */
  schedules_enabled?: boolean;
  created_at: string;
}

export type ApprovalGroup = string;
export type ApprovalGroupFilter = ApprovalGroup | 'unassigned';

export interface ApprovalGroupOption {
  key: string;
  label: string;
}

export interface UserSummary {
  id: number;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  display_name: string;
  full_name: string;
  role: string;
  is_active: boolean;
  employment_status: 'active' | 'pending' | 'inactive' | 'terminated';
  termination_effective_on?: string | null;
  is_intern?: boolean;
  approval_group?: ApprovalGroup | null;
  approval_group_label?: string;
  approval_group_keys?: ApprovalGroup[];
  approval_group_labels?: string[];
  approval_groups?: ApprovalGroupOption[];
  time_category_ids?: number[];
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
  role: UserRole;
  /** Roles the signed-in owner or admin may give this person; empty when they can't change it. */
  assignable_roles?: UserRole[];
  /** Whether the signed-in owner or admin may terminate, reactivate or remove sign-in for this person. */
  can_change_access?: boolean;
  my_pay_enabled?: boolean;
  staff_title: string | null;
  is_intern?: boolean;
  approval_group?: ApprovalGroup | null;
  approval_group_label?: string;
  approval_group_keys?: ApprovalGroup[];
  approval_group_labels?: string[];
  approval_groups?: ApprovalGroupOption[];
  is_active: boolean;
  employment_status: 'active' | 'pending' | 'inactive' | 'terminated';
  terminated_at: string | null;
  termination_effective_on: string | null;
  termination_reason: string | null;
  terminated_by: { id: number; full_name: string } | null;
  can_delete_permanently: boolean;
  is_pending: boolean;
  has_clerk_account: boolean;
  uses_clerk_profile: boolean;
  personal_access_enabled: boolean;
  profile_source: 'clerk' | 'local';
  time_tracking_enabled: boolean;
  public_team_enabled: boolean;
  public_team_name: string | null;
  public_team_title: string | null;
  public_team_sort_order: number;
  public_team_photo_position_x: number;
  public_team_photo_position_y: number;
  public_team_photo_url?: string | null;
  public_team_photo_thumb_url?: string | null;
  public_team_photo_card_url?: string | null;
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
  deletable?: boolean;
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
  clock_in_location_enforced: string;
  clock_in_location_name: string;
  clock_in_location_latitude: string;
  clock_in_location_longitude: string;
  clock_in_location_radius_meters: string;
  /** "false" (default) or "true". No control on the Settings page yet. */
  schedule_required_for_clock_in?: string;
  /** "true" (default) or "false". Off sends a manager's own time to another approver. */
  managers_can_approve_own_time?: string;
  /** "false" (default) or "true". Approves employees' ordinary shifts at clock-out. */
  auto_approve_ordinary_shifts?: string;
  /** Hours, default "12". Shifts this long or longer are never auto-approved. */
  auto_approve_max_shift_hours?: string;
  /** "false" (default) or "true". Shows "Request my pay stub" at the kiosk. */
  pay_stub_kiosk_requests_enabled?: string;
  /** "false" (default) or "true". Shows "Email me this stub" in My Pay. */
  pay_stub_self_email_enabled?: string;
  /** "false" (default) or "true". "Use schedules": shows Schedule in the navigation. */
  schedules_enabled?: string;
}

export interface AdminAppSettingsResponse {
  settings: TimeClockAppSettings;
  approval_groups: ApprovalGroupOption[];
  /** What each setting does, from the backend's SettingsCatalog. */
  catalog?: SettingsCatalogEntry[];
}

/** One entry of the backend's SettingsCatalog (backend/app/models/settings_catalog.rb). */
export interface SettingsCatalogEntry {
  id: string;
  label: string;
  section: string;
  section_label: string;
  /** The page the setting is changed on: "Settings" or "Team". */
  page: string;
  path: string;
  setting_keys: string[];
  stored_in: string | null;
  /** False when the Settings page shows the value but has no control for it yet. */
  on_page: boolean;
  capability: string;
  who_roles: string[];
  who: string;
  what: string;
  default: string;
  example: string;
  access_effect: { rows: string[]; on: string; off: string } | null;
}

export type AccessCellValue = 'yes' | 'no' | 'limited'

export interface AccessGuideRow {
  key: string;
  kind: 'capability' | 'rule';
  label: string;
  detail: string;
  /** footnotes: ids of the settings (AccessGuideSettingEffect) that change this answer. */
  cells: Record<string, { value: AccessCellValue; note?: string; footnotes?: string[] }>;
  /** Every setting that changes some answer in this row. */
  footnotes: string[];
}

export interface AccessGuideRoleCard {
  key: string;
  label: string;
  summary: string;
  can: string[];
  cannot: string[];
  assigned_by: string[];
  signs_in_personally: boolean;
  /** Only for owners and admins. */
  members?: { id: number; name: string }[];
}

export interface AccessGuideSettingEffect {
  id: string;
  label: string;
  enabled: boolean;
  effect: string;
  rows: string[];
  change_in: string;
  path: string;
  who: string;
  /** People with My Pay on individually. Only for owners and admins. */
  individual_count?: number;
}

/** GET /api/v1/access_guide, built from User::ROLE_CAPABILITIES and the role rules. */
export interface AccessGuideResponse {
  viewer: { role: string; can_see_members: boolean; can_change_settings: boolean };
  roles: AccessGuideRoleCard[];
  rows: AccessGuideRow[];
  rules: { key: string; text: string }[];
  settings: AccessGuideSettingEffect[];
  everyone_can: string[];
  role_capabilities: Record<string, string[]>;
}

export interface GeocodeResult {
  display_name: string;
  latitude: string;
  longitude: string;
}

export interface PlaceAutocompleteSuggestion {
  place_id: string;
  description: string;
  main_text?: string | null;
  secondary_text?: string | null;
}

export interface PlaceDetails {
  place_id: string;
  display_name?: string | null;
  formatted_address?: string | null;
  latitude: string;
  longitude: string;
  plus_code?: string | null;
}

export interface SocialLink {
  key: string;
  label: string;
  url: string;
}

export interface ContactSettings {
  contact_notification_emails: string[];
  inquiry_topics: string[];
  public_contact: PublicContactInfoSettings;
  social_links: SocialLink[];
}

export interface PublicContactSettings {
  inquiry_topics: string[];
  public_contact: PublicContactInfoSettings;
  social_links: SocialLink[];
}

export type SiteMediaType = 'image' | 'video';

export type SiteMediaPlacement =
  | 'home_hero'
  | 'home_training'
  | 'home_tours'
  | 'home_video'
  | 'programs_hero'
  | 'programs_training'
  | 'tour_bay'
  | 'tour_island'
  | 'tour_sunset'
  | 'programs_video'
  | 'discovery_hero'
  | 'team_hero'
  | 'careers_hero'
  | 'contact_feature';

export interface SiteMedia {
  id: number;
  title: string;
  alt_text: string | null;
  caption: string | null;
  placement: SiteMediaPlacement;
  media_type: SiteMediaType;
  external_url: string | null;
  file_url: string | null;
  file_thumb_url?: string | null;
  file_card_url?: string | null;
  file_hero_url?: string | null;
  poster_url: string | null;
  poster_thumb_url?: string | null;
  poster_card_url?: string | null;
  poster_hero_url?: string | null;
  sort_order: number;
  active: boolean;
  featured: boolean;
  metadata: Record<string, unknown>;
  uploaded_by_id?: number | null;
  created_at?: string;
  updated_at?: string;
}

export interface SiteMediaInput {
  title: string;
  alt_text?: string;
  caption?: string;
  placement: SiteMediaPlacement;
  media_type: SiteMediaType;
  external_url?: string;
  sort_order?: number;
  active?: boolean;
  featured?: boolean;
  file?: File | null;
  poster?: File | null;
}

function siteMediaFormData(input: SiteMediaInput) {
  const formData = new FormData();
  formData.append('title', input.title);
  formData.append('placement', input.placement);
  formData.append('media_type', input.media_type);
  formData.append('alt_text', input.alt_text || '');
  formData.append('caption', input.caption || '');
  formData.append('external_url', input.external_url || '');
  formData.append('sort_order', String(input.sort_order ?? 0));
  formData.append('active', String(input.active ?? true));
  formData.append('featured', String(input.featured ?? false));
  if (input.file) formData.append('file', input.file);
  if (input.poster) formData.append('poster', input.poster);
  return formData;
}

export interface PublicTeamMember {
  id: number;
  name: string;
  title: string;
  photo_url: string | null;
  photo_thumb_url: string | null;
  photo_alt: string | null;
  photo_position_x: number;
  photo_position_y: number;
}

export interface ApprovalReason {
  key: string;
  label: string;
}

// Safe status returned by the employee time-entry reads. Manager evidence is
// deliberately a separate type and response contract.
export interface EmployeePayrollStatus {
  status: PayrollEntryLifecycleStatus | 'held' | 'payment_history_unavailable';
  label: string;
  paid_hours: number;
  held_hours: number;
  // Present only on the worker's own entries when My Pay is enabled for them.
  paychecks?: { statement_id: string; pay_date: string | null }[];
  note?: string;
}

export interface TimeEntry {
  payroll_cutoff_missed?: boolean;
  payroll_status?: EmployeePayrollStatus | null;
  version?: number;
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
  /** Approved at clock-out by "Auto-approve ordinary shifts"; approved_by is null. */
  auto_approved?: boolean;
  overtime_status: 'none' | 'pending' | 'approved' | 'denied' | null;
  pending_overtime_hours?: number;
  approval_reasons?: ApprovalReason[];
  /** The viewer's own entry while "Managers can approve their own time" is off. */
  needs_another_approver?: boolean;
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
    is_intern?: boolean;
    approval_group?: ApprovalGroup | null;
    approval_group_label?: string;
    approval_group_keys?: ApprovalGroup[];
    approval_group_labels?: string[];
    approval_groups?: ApprovalGroupOption[];
    time_category_ids?: number[];
  };
  time_category: {
    id: number;
    key?: string | null;
    name: string;
  } | null;
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
  review_alerts?: {
    daily_threshold_exceeded: boolean;
    weekly_threshold_exceeded: boolean;
  };
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
  time_tracking_enabled: boolean;
  clock_in_blocked_reason: 'already_clocked_in' | 'time_tracking_disabled' | 'categories_missing' | 'no_schedule' | 'too_early' | 'shift_ended' | 'inactive_employee' | null;
  minutes_until?: number;
  clock_in_location_required?: boolean;
  clock_in_location_name?: string | null;
  clock_in_location_radius_meters?: number | null;
  /** Owner or admin. */
  is_admin?: boolean;
  /** Owners, admins and managers may clock in outside the schedule window. */
  can_override_clock?: boolean;
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
  /** "Pay stub requests at the kiosk" in Settings; off by default. */
  pay_stub_requests_enabled?: boolean;
}

export interface KioskSessionResponse {
  kiosk_access_token: string;
  expires_at: string;
  unlocked_by: {
    id: number;
    full_name: string;
  };
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
  /** Set when the open clock started on an earlier work date (a likely missed clock-out). */
  open_since_work_date?: string | null;
  open_entry_id?: number | null;
}

export type LeaveRequestQueryStatus = LeaveRequest['status'] | 'reviewed';

export interface LeaveRequest {
  id: number;
  leave_type: 'paid_time_off' | 'sick' | 'unpaid' | 'bereavement' | 'other';
  start_date: string;
  end_date: string;
  status: 'pending' | 'approved' | 'declined' | 'cancelled';
  reason: string | null;
  review_note: string | null;
  total_days: number;
  reviewed_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
  user: {
    id: number;
    email: string;
    display_name?: string;
    full_name?: string;
  };
  reviewed_by: {
    id: number;
    full_name: string;
  } | null;
  cancelled_by: {
    id: number;
    full_name: string;
  } | null;
}

export interface PaginationMeta {
  current_page: number;
  per_page: number;
  total_count: number;
  total_pages: number;
}

export interface ClockLocationPayload {
  latitude: number;
  longitude: number;
  accuracy_meters?: number;
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
    denied_hours?: number;
    total_break_hours: number;
    entry_count: number;
  };
}

export interface PendingApprovalsSummary {
  total_hours: number;
  entry_count: number;
  oldest_work_date: string | null;
  newest_work_date: string | null;
  pending_time_entry_count: number;
  pending_overtime_count: number;
  manual_count: number;
  clock_count: number;
  counts_by_date: Array<{ work_date: string; count: number; hours: number }>;
  counts_by_approval_group?: Array<{ key: ApprovalGroupFilter; label: string; count: number }>;
}

export interface PendingApprovalsParams {
  approval_group?: ApprovalGroupFilter;
  date?: string;
  start_date?: string;
  end_date?: string;
  through_date?: string;
  since_date?: string;
  user_id?: number;
  time_category_id?: number;
  approval_type?: 'time_entry' | 'overtime' | 'both';
  entry_method?: 'clock' | 'manual';
  clock_source?: 'kiosk' | 'mobile' | 'admin' | 'legacy';
  sort?: 'work_date' | 'created_at' | 'employee' | 'hours' | 'approval_type' | 'category';
  direction?: 'asc' | 'desc';
  page?: number;
  per_page?: number;
}

export interface PendingApprovalsResponse {
  pending_entries: TimeEntry[];
  count: number;
  pagination?: PaginationMeta & { truncated?: boolean };
  summary?: PendingApprovalsSummary;
  filters?: Record<string, string | number>;
  sort?: { field: string; direction: 'asc' | 'desc' };
}

export interface HoursReportEntry {
  id: number;
  version?: number;
  work_date: string;
  start_time: string | null;
  end_time: string | null;
  formatted_start_time: string | null;
  formatted_end_time: string | null;
  total_hours: number;
  regular_hours: number;
  overtime_hours: number;
  break_minutes: number;
  description: string | null;
  entry_method: string;
  clock_source: string | null;
  approval_status: string | null;
  approved_by: { id: number; full_name: string } | null;
  auto_approved?: boolean;
  approved_at: string | null;
  overtime_status: string | null;
  time_category: { id: number; key?: string | null; name: string } | null;
  breaks: Array<{ id: number; start_time: string | null; end_time: string | null; duration_minutes: number | null }>;
  payroll_lifecycle?: PayrollEntryLifecycle;
  quality_flags: Array<'missing_category' | 'missing_description' | 'long_shift' | 'overlap' | 'overnight_allocation_review'>;
}

export type PayrollEntryLifecycleStatus =
  | 'awaiting_approval'
  | 'not_payable'
  | 'ready_for_cutoff'
  | 'finalized'
  | 'imported'
  | 'committed'
  | 'payment_prepared'
  | 'payment_issued'
  | 'payment_failed'
  | 'payment_cancelled'
  | 'payment_voided'
  | 'partially_paid'
  | 'partially_prepared'
  | 'partially_processed'
  | 'partially_allocated'
  | 'payment_attested_pending_evidence';

export type HoursReportPayrollStatuses = Partial<Record<PayrollEntryLifecycleStatus | 'accounting_correction_committed', number>>;

export interface AccountingCorrectionContext {
  accounting_only: true;
  correction_disposition_id: string;
  original_pay_period_id: string;
  original_payroll_item_id: string;
  corrective_pay_period_id: string;
  corrective_payroll_item_id: string;
}

export interface PayrollPayableLine {
  accounting_only?: boolean;
  accounting_correction?: AccountingCorrectionContext;
  accounting_correction_hours?: number;
  accounting_correction_line_count?: number;
  source_time_entry_id: string;
  source_line_key: string;
  source_kind: string;
  total_hours: number;
  regular_hours: number;
  overtime_hours: number;
  status: PayrollEntryLifecycleStatus;
  occurred_at?: string | null;
  external_pay_period_id?: string | null;
  external_payroll_item_id?: string | null;
  payment_method?: string | null;
  payment_reference?: string | null;
}


export interface PayrollEntrySettlement {
  accounting_only?: boolean;
  accounting_correction?: AccountingCorrectionContext;
  accounting_correction_hours?: number;
  accounting_correction_line_count?: number;
  batch_id: string;
  start_date: string;
  end_date: string;
  status: PayrollEntryLifecycleStatus;
  label: string;
  occurred_at: string;
  source_kinds: string[];
  total_hours: number;
  regular_hours: number;
  overtime_hours: number;
  paid_hours: number;
  prepared_hours: number;
  failed_hours: number;
  voided_hours: number;
  outstanding_hours: number;
  payable_lines: PayrollPayableLine[];
  external_pay_period_id?: string | null;
  external_payroll_item_id?: string | null;
  payment_method?: string | null;
  payment_reference?: string | null;
  payment_effective_on?: string | null;
}

export interface PayrollEntryLifecycle {
  accounting_only?: boolean;
  accounting_correction?: AccountingCorrectionContext;
  accounting_correction_hours?: number;
  accounting_correction_line_count?: number;
  status: PayrollEntryLifecycleStatus;
  label: string;
  payment_method?: string | null;
  payment_reference?: string | null;
  payment_effective_on?: string | null;
  occurred_at?: string | null;
  latest_excluded_batch_id?: string | null;
  manually_committed_hours?: number;
  manually_paid_hours?: number;
  payment_attested_hours?: number;
  payment_attested_at?: string;
  payment_attestation_source_changed?: boolean;
  resolved_payment_report?: {
    id: string;
    attested_at: string;
    reason: string;
    resolved_at: string;
    resolution_reason: string;
    manual_allocation_id: string;
    issued_event_id: string;
  };
  settlements: PayrollEntrySettlement[];
}

export interface HoursReportDay {
  work_date: string;
  total_hours: number;
  regular_hours: number;
  overtime_hours: number;
  break_hours: number;
  entries: HoursReportEntry[];
}

export interface HoursReportCategory {
  id: number | null;
  key?: string | null;
  name: string;
  total_hours: number;
  regular_hours: number;
  overtime_hours: number;
  break_hours: number;
  entries_count: number;
}

export interface HoursReportSource {
  source: string;
  total_hours: number;
  regular_hours: number;
  overtime_hours: number;
  break_hours: number;
  entries_count: number;
}

export interface HoursReportWeek {
  week_start: string;
  week_end: string;
  weekly_total_hours: number;
  period_hours: number;
  context_hours: number;
  regular_hours: number;
  overtime_hours: number;
  context_note: string | null;
}

export interface HoursReportEmployee {
  id: number;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  display_name: string;
  full_name: string;
  role: UserRole;
  is_intern: boolean;
  employee_type?: 'Intern' | 'Staff' | string;
  status: 'active' | 'pending' | 'inactive' | 'terminated';
  terminated_at: string | null;
  termination_effective_on: string | null;
  approval_group?: ApprovalGroup | null;
  approval_group_label?: string | null;
  approval_group_keys?: ApprovalGroup[];
  approval_group_labels?: string[];
  approval_groups?: ApprovalGroupOption[];
  total_hours: number;
  regular_hours: number;
  overtime_hours: number;
  break_hours: number;
  entries_count: number;
  days_worked: number;
  first_work_date: string | null;
  last_work_date: string | null;
  ready: boolean;
  issues: {
    pending_count: number;
    denied_count: number;
    pending_overtime_count: number;
    denied_overtime_count: number;
    open_clock_count: number;
    uncategorized_count: number;
    allocation_hold_count?: number;
  };
  quality: HoursReportQuality;
  payroll_statuses?: HoursReportPayrollStatuses;
  days: HoursReportDay[];
  excluded_entries?: HoursReportEntry[];
  categories: HoursReportCategory[];
  weeks: HoursReportWeek[];
}

export interface HoursReportFilters {
  user_id?: string | number;
  role?: string;
  status?: string;
  approval_group?: string;
  time_category_id?: string | number;
  category_status?: 'uncategorized';
  clock_source?: string;
  entry_method?: string;
  approval_status?: string;
  overtime_status?: string;
  include_empty?: string | boolean;
}

export interface HoursReportResponse {
  start_date: string;
  end_date: string;
  context_start_date: string;
  context_end_date: string;
  generated_at: string;
  ready: boolean;
  quality: HoursReportQuality;
  filters: HoursReportFilters;
  summary: {
    employee_count: number;
    total_hours: number;
    regular_hours: number;
    overtime_hours: number;
    break_hours: number;
    entries_count: number;
    pending_count: number;
    denied_count: number;
    pending_overtime_count: number;
    denied_overtime_count: number;
    open_clock_count: number;
    uncategorized_count: number;
    allocation_hold_count?: number;
    payroll_statuses?: HoursReportPayrollStatuses;
  };
  breakdowns: {
    by_category: HoursReportCategory[];
    by_source: HoursReportSource[];
  };
  employees: HoursReportEmployee[];
}

export interface HoursReportParams {
  start_date: string;
  end_date: string;
  user_id?: number;
  role?: UserRole;
  status?: 'all' | 'active' | 'current' | 'pending' | 'inactive' | 'terminated';
  approval_group?: ApprovalGroupFilter | 'all';
  time_category_id?: number;
  category_status?: 'uncategorized';
  clock_source?: 'kiosk' | 'mobile' | 'admin' | 'legacy';
  entry_method?: 'clock' | 'manual';
  approval_status?: 'pending' | 'approved' | 'denied' | 'approved_or_standard';
  overtime_status?: 'none' | 'pending' | 'approved' | 'denied';
  include_empty?: boolean;
}

export interface HoursReportQuality {
  status: 'clear' | 'needs_review';
  missing_category_count: number;
  missing_description_count: number;
  long_shift_count: number;
  overlapping_entry_count: number;
}

export interface AuditLogEntry {
  id: number;
  action: string;
  event_category: string;
  occurred_at: string;
  outcome: string;
  source: string;
  summary: string;
  actor: {
    id: number | null;
    name: string | null;
    email: string | null;
    role: string | null;
    kind: string;
  };
  subject: {
    type: string;
    id: number;
    name: string | null;
  };
  changes: Record<string, unknown>;
  details: Record<string, unknown>;
  request: {
    id: string | null;
    ip_address: string | null;
    user_agent: string | null;
    correlation_id: string | null;
  };
}

export interface AuditLogFilters {
  actor_id?: number;
  event_category?: string;
  source?: string;
  outcome?: string;
  subject_type?: string;
  subject_id?: number;
  event_action?: string;
  search?: string;
  from?: string;
  to?: string;
  page?: number;
  per_page?: number;
}

export interface AuditLogResponse {
  audit_logs: AuditLogEntry[];
  pagination: { page: number; per_page: number; total: number; total_pages: number };
  filters: { event_categories: string[]; sources: string[]; outcomes: string[] };
}

export interface PayrollBatchSummary {
  employee_count: number;
  adjustment_count: number;
  total_hours: number;
  regular_hours: number;
  overtime_hours: number;
  current_count: number;
  carryover_count: number;
  correction_count: number;
  exclusion_count: number;
}

export interface PayrollBatchIssues {
  payment_attestation_pending_count?: number;
  missing_category_count: number;
  negative_adjustment_count: number;
  pending_approval_count: number;
  denied_approval_count: number;
  open_clock_count: number;
  pending_overtime_count: number;
  denied_overtime_count: number;
}

export interface PayrollBatchAdjustment {
  source_time_entry_id: string;
  line_key: string;
  source_kind: 'current' | 'carryover' | 'correction';
  original_work_date: string;
  original_week_start: string;
  source_category_id: string | null;
  category: { id: number; key: string | null; name: string } | null;
  total_hours: number;
  regular_hours: number;
  overtime_hours: number;
}

export interface PayrollBatchEmployee {
  source_user_id: string;
  source_user_uuid?: string | null;
  email: string | null;
  display_name: string;
  adjustments: PayrollBatchAdjustment[];
  total_hours: number;
  regular_hours: number;
  overtime_hours: number;
}

export interface PayrollBatchExclusion {
  source_time_entry_id: string;
  source_user_id: string;
  source_user_uuid?: string | null;
  display_name: string;
  email: string | null;
  category: { id: number; key: string | null; name: string } | null;
  reason: string;
  original_work_date: string;
  held_total_hours: number;
  held_regular_hours: number;
  held_overtime_hours: number;
  first_excluded_batch_id: string;
}

export interface PayrollBatchPayload {
  connected_payroll?: ConnectedPayrollCapability;
  schema_version: string;
  source: string;
  batch_id: string;
  start_date: string;
  end_date: string;
  cutoff_at: string;
  generated_at: string;
  employees: PayrollBatchEmployee[];
  exclusions: PayrollBatchExclusion[];
  issues: PayrollBatchIssues;
  summary: PayrollBatchSummary;
  preview?: boolean;
  can_finalize?: boolean;
  requires_negative_adjustment_acknowledgement?: boolean;
  finalization_blocked_reason?: string | null;
  published_calendar_periods?: Array<{
    external_pay_period_id: string;
    start_date: string;
    end_date: string;
    cutoff_at: string;
    status: 'scheduled' | 'failed' | 'finalized';
    payroll_batch_id?: string | null;
  }>;
  negative_adjustment_acknowledgement?: string;
  export?: {
    id: string;
    batch_id: string;
    checksum: string;
    checksum_algorithm: 'SHA-256';
    checksum_scope: 'payload_without_export';
    readiness_status: 'finalized';
    cutoff_at: string;
    finalized_at: string;
  };
}

export interface PayrollBatchListItem {
  purpose?: 'regular' | 'supplemental';
  id: string;
  start_date: string;
  end_date: string;
  cutoff_at: string;
  finalized_at: string;
  finalized_by: { id: number; name: string } | null;
  checksum: string;
  processing: PayrollBatchProcessingStatus | PayrollEntryProcessingStatus | null;
  summary: PayrollBatchSummary;
  issues: PayrollBatchIssues;
}

export interface PayrollBatchProcessingStatus {
  status: 'imported' | 'committed' | 'payment_issued' | 'payment_failed';
  occurred_at: string;
  external_system: string;
  external_pay_period_id: string | null;
}

export interface PayrollEntryProcessingStatus extends Omit<PayrollBatchProcessingStatus, 'status' | 'external_pay_period_id'> {
  accounting_only?: boolean;
  accounting_correction_hours?: number;
  accounting_correction_line_count?: number;
  status: 'imported' | 'committed' | 'payment_prepared' | 'payment_issued' | 'payment_failed' | 'payment_cancelled' | 'payment_voided' | 'partially_paid' | 'partially_prepared' | 'partially_processed';
  external_pay_period_id?: string | null;
  paid_hours?: number;
  prepared_hours?: number;
  failed_hours?: number;
  voided_hours?: number;
  outstanding_hours?: number;
  lines?: PayrollPayableLine[];
}

export interface ManualPayrollProcessingInput {
  cutoff_at: string;
  processed_at: string;
  external_pay_period_id: string;
  processing_note: string;
  acknowledge_missing_categories: boolean;
}

export interface PayrollCarryoverItem {
  settlement_case?: {
    id: string;
    status: string;
    destination_kind: string;
    resolution_note?: string | null;
    decision?: {
      event_id: string;
      event_type: string;
      occurred_at: string;
      reason?: string;
      actor?: { name: string; payroll_integration_id?: string };
    };
  } | null;
  completion?: 'paid' | 'accounting_recorded' | null;
  source_time_entry_id: string;
  source_user_id: string;
  source_user_uuid?: string | null;
  display_name: string;
  email: string | null;
  category: { id: number; key: string | null; name: string } | null;
  original_work_date: string;
  first_excluded_batch_id: string;
  latest_excluded_batch_id: string;
  exclusion_reason: string;
  held_total_hours: number;
  current_total_hours: number | null;
  payroll_lifecycle?: PayrollEntryLifecycle;
  status: 'scheduled_supplemental' | 'needs_review' | 'partially_allocated' | 'payment_attested_pending_evidence' | 'awaiting_approval' | 'ready_for_next_batch' | 'awaiting_cornerstone' | 'imported' | 'committed' | 'payment_prepared' | 'payment_issued' | 'payment_failed' | 'payment_cancelled' | 'payment_voided' | 'partially_paid' | 'partially_prepared' | 'partially_processed' | 'not_payable';
  included_batch: {
    id: string;
    start_date: string;
    end_date: string;
    processing: PayrollEntryProcessingStatus | PayrollBatchProcessingStatus | null;
  } | null;
}

export interface PayrollCarryoverQueue {
  items: PayrollCarryoverItem[];
  summary: {
    awaiting_approval_count: number;
    ready_for_next_batch_count: number;
    needs_review_count?: number;
    in_payroll_count: number;
    not_payable_count: number;
    unresolved_count?: number;
    paid_count?: number;
    accounting_recorded_count?: number;
  };
  truncated: boolean;
}

export interface PayrollBatchDetail extends PayrollBatchListItem {
  payload: PayrollBatchPayload;
}

export interface PayrollAccountLinkSession {
  external_actor_email: string | null;
  expires_at: string;
  return_url: string;
  aire_user: {
    name: string;
    email: string | null;
  };
}

export interface PayrollAccountLink {
  connected: boolean;
  aire_user_name?: string;
  aire_user_email?: string | null;
  linked_at?: string;
}

// Schedule Types

export interface Schedule {
  approved_leave_conflict?: boolean;
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

export interface ApprovedLeaveAvailability {
  id: number;
  user_id: number;
  start_date: string;
  end_date: string;
}

export interface SchedulesResponse {
  approved_leave: ApprovedLeaveAvailability[];
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

export interface PayrollCutoff {
  period: { id: number; start_date: string; end_date: string } | null;
  publication_id: string | null;
  version: number | null;
  now: string;
  cutoff_at: string | null;
  seconds_remaining: number | null;
  time_zone: string;
  stage: 'none' | '24h' | '4h' | 'passed' | 'finalizing';
}
export interface PayrollCutoffAttention {
  period: NonNullable<PayrollCutoff['period']>;
  lock_mode: 'manual' | 'scheduled';
  cutoff_state: 'attention_required';
}
/** The next scheduled lock and what an owner or admin may do with it. Cornerstone Payroll applies every change. */
export interface PayrollLockControl {
  period: { id: number; external_pay_period_id: string; start_date: string; end_date: string; pay_date: string };
  publication_id: string;
  schedule_version: number;
  status: 'scheduled' | 'failed' | 'finalized';
  cutoff_state: string;
  cutoff_at: string;
  cutoff_source: 'policy' | 'override';
  default_cutoff_at: string;
  override: {
    action: 'lock_now' | 'change';
    reason: string;
    set_at: string | null;
    set_by_name: string | null;
    set_by_system: 'cornerstone_payroll' | 'aire_services' | null;
    previous_cutoff_at: string | null;
  } | null;
  earliest_cutoff_at: string;
  latest_cutoff_at: string;
  lock_now_available_at: string;
  can_change: boolean;
  can_lock_now: boolean;
  can_reset: boolean;
  /** A change asked for here that Cornerstone accepted and AIRE hasn't applied yet. */
  pending_change?: PayrollLockPendingChange | null;
  unavailable_reason: string | null;
}
export interface PayrollLockPendingChange {
  /** expired: its time passed before it arrived, so AIRE can't apply it. */
  state: 'pending' | 'rejected' | 'expired';
  action: PayrollLockAction;
  cutoff_at: string | null;
  requested_by_name: string | null;
  requested_at: string;
  error: string | null;
}
export type PayrollLockAction = 'lock_now' | 'change' | 'reset'
export interface PayrollLockTimeRequest {
  external_pay_period_id: string;
  publication_id: string;
  lock_action: PayrollLockAction;
  reason: string;
  cutoff_at?: string;
  request_id: string;
}
export interface PayrollCutoffResponse { connected_payroll?: ConnectedPayrollCapability; cutoff: PayrollCutoff; acknowledged?: boolean; preparation_period?: PayrollCutoff['period']; attention?: PayrollCutoffAttention | null; lock_control?: PayrollLockControl | null }
export interface PayrollCutoffIdentity { period_id: number; publication_id: string; version: number; stage: string }

export const api = {
  getPayrollCutoff: (kioskAccessToken?: string, kioskToken?: string) => kioskAccessToken !== undefined
    ? fetchApi<PayrollCutoffResponse>('/api/v1/aire/kiosk/cutoff', { method: 'POST', body: JSON.stringify({ kiosk_access_token: kioskAccessToken, ...(kioskToken ? { kiosk_token: kioskToken } : {}) }) }, false)
    : fetchApi<PayrollCutoffResponse>('/api/v1/payroll_cutoff'),
  changePayrollLockTime: (request: PayrollLockTimeRequest) =>
    fetchApi<{ cutoff_change: { cutoff_at: string; action: PayrollLockAction }; lock_control: PayrollLockControl | null }>('/api/v1/payroll_cutoff/lock_time', {
      method: 'POST', body: JSON.stringify(request),
    }),
  acknowledgePayrollCutoff: (identity: PayrollCutoffIdentity, kiosk?: { accessToken: string; employeeToken: string }) =>
    fetchApi<{ acknowledged: boolean }>(kiosk ? '/api/v1/aire/kiosk/cutoff/acknowledge' : '/api/v1/payroll_cutoff/acknowledge', {
      method: 'POST', body: JSON.stringify({ ...identity, ...(kiosk ? { kiosk_access_token: kiosk.accessToken, kiosk_token: kiosk.employeeToken } : {}) }),
    }, !kiosk),
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

  getPayrollAccountLinkSession: (token: string) =>
    fetchApi<{ account_link_session: PayrollAccountLinkSession }>(
      `/api/v1/payroll/account_link_sessions/${encodeURIComponent(token)}`
    ),

  authorizePayrollAccountLink: (token: string) =>
    fetchApi<{ account_link: PayrollAccountLink; redirect_url: string }>(
      `/api/v1/payroll/account_link_sessions/${encodeURIComponent(token)}/authorize`,
      { method: 'POST' }
    ),

  // Contact form (public)
  getPublicContactSettings: () =>
    fetchApiPublic<PublicContactSettings>('/api/v1/contact_settings'),

  getPublicTeamMembers: () =>
    fetchApiPublic<{ team_members: PublicTeamMember[] }>('/api/v1/team_members'),

  getPublicSiteMedia: (placements?: SiteMediaPlacement[]) => {
    const query = placements && placements.length > 0
      ? `?placements=${encodeURIComponent(placements.join(','))}`
      : '';
    return fetchApiPublic<{ site_media: SiteMedia[]; by_placement: Partial<Record<SiteMediaPlacement, SiteMedia[]>> }>(`/api/v1/site-media${query}`);
  },

  submitContact: (data: { name: string; email: string; phone?: string; subject: string; message: string }) =>
    fetchApiPublic<{ success: boolean; message: string }>('/api/v1/contact', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  // AIRE Kiosk (public, PIN-based auth)
  aireKioskVerify: (pin: string, kioskAccessToken: string) =>
    fetchApi<AireKioskVerifyResponse>('/api/v1/aire/kiosk/verify', {
      method: 'POST',
      body: JSON.stringify({ pin, kiosk_access_token: kioskAccessToken }),
    }),

  aireKioskClockIn: (kioskAccessToken: string, kioskToken: string, timeCategoryId?: number | null) =>
    fetchApi<AireKioskActionResponse>('/api/v1/aire/kiosk/clock_in', {
      method: 'POST',
      body: JSON.stringify({
        kiosk_access_token: kioskAccessToken,
        kiosk_token: kioskToken,
        ...(timeCategoryId ? { time_category_id: timeCategoryId } : {}),
      }),
    }),

  aireKioskClockOut: (kioskAccessToken: string, kioskToken: string) =>
    fetchApi<AireKioskActionResponse>('/api/v1/aire/kiosk/clock_out', {
      method: 'POST',
      body: JSON.stringify({ kiosk_access_token: kioskAccessToken, kiosk_token: kioskToken }),
    }),

  aireKioskStartBreak: (kioskAccessToken: string, kioskToken: string) =>
    fetchApi<AireKioskActionResponse>('/api/v1/aire/kiosk/start_break', {
      method: 'POST',
      body: JSON.stringify({ kiosk_access_token: kioskAccessToken, kiosk_token: kioskToken }),
    }),

  aireKioskEndBreak: (kioskAccessToken: string, kioskToken: string) =>
    fetchApi<AireKioskActionResponse>('/api/v1/aire/kiosk/end_break', {
      method: 'POST',
      body: JSON.stringify({ kiosk_access_token: kioskAccessToken, kiosk_token: kioskToken }),
    }),

  aireKioskSwitchCategory: (kioskAccessToken: string, kioskToken: string, timeCategoryId: number) =>
    fetchApi<AireKioskActionResponse>('/api/v1/aire/kiosk/switch_category', {
      method: 'POST',
      body: JSON.stringify({ kiosk_access_token: kioskAccessToken, kiosk_token: kioskToken, time_category_id: timeCategoryId }),
    }),

  // Users (staff list for dropdowns)
  getUsers: () =>
    fetchApi<{ users: UserSummary[]; approval_groups?: ApprovalGroupOption[] }>('/api/v1/users'),

  // Admin: User Management
  getAdminUsers: () =>
    fetchApi<{ users: AdminUser[] }>('/api/v1/admin/users'),

  inviteUser: (data: {
    email?: string;
    first_name?: string;
    last_name?: string;
    staff_title?: string | null;
    is_intern?: boolean;
    role: UserRole;
    approval_group?: ApprovalGroup | null;
    approval_groups?: ApprovalGroup[];
    send_invitation?: boolean;
    personal_access_enabled?: boolean;
    time_tracking_enabled?: boolean;
    kiosk_enabled?: boolean;
    kiosk_pin?: string;
    time_category_ids?: number[];
  }) =>
    fetchApi<InvitationEmailOutcome & { user: AdminUser; kiosk_pin: string | null }>('/api/v1/admin/users', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateUserRole: (id: number, role: UserRole) =>
    fetchApi<{ user: AdminUser }>(`/api/v1/admin/users/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ role }),
    }),

  updateUser: (id: number, data: {
    first_name?: string;
    last_name?: string;
    email?: string | null;
    role?: UserRole;
    staff_title?: string | null;
    is_intern?: boolean;
    approval_group?: ApprovalGroup | null;
    approval_groups?: ApprovalGroup[];
    is_active?: boolean;
    public_team_enabled?: boolean;
    public_team_name?: string | null;
    public_team_title?: string | null;
    public_team_sort_order?: number;
    public_team_photo_position_x?: number;
    public_team_photo_position_y?: number;
    personal_access_enabled?: boolean;
    time_tracking_enabled?: boolean;
    kiosk_enabled?: boolean;
    kiosk_pin?: string;
    send_invitation?: boolean;
    time_category_ids?: number[];
  }) =>
    fetchApi<InvitationEmailOutcome & { user: AdminUser; kiosk_pin?: string | null }>(`/api/v1/admin/users/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  updateUserPublicTeamPhoto: (id: number, photo: File) => {
    const formData = new FormData();
    formData.append('photo', photo);
    return fetchApiUpload<{ user: AdminUser }>(`/api/v1/admin/users/${id}/public_team_photo`, formData);
  },

  removeUserPublicTeamPhoto: (id: number) =>
    fetchApi<{ user: AdminUser }>(`/api/v1/admin/users/${id}/public_team_photo`, {
      method: 'DELETE',
    }),

  deleteUser: (id: number) =>
    fetchApi<void>(`/api/v1/admin/users/${id}`, {
      method: 'DELETE',
    }),

  terminateUser: (id: number, data: { effective_on: string; reason?: string }) =>
    fetchApi<{ user: AdminUser }>(`/api/v1/admin/users/${id}/terminate`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  reactivateUser: (id: number) =>
    fetchApi<{ user: AdminUser }>(`/api/v1/admin/users/${id}/reactivate`, {
      method: 'POST',
    }),

  resendInvite: (id: number) =>
    fetchApi<InvitationEmailOutcome & { message: string }>(`/api/v1/admin/users/${id}/resend_invite`, {
      method: 'POST',
    }),

  getAccessGuide: () =>
    fetchApi<AccessGuideResponse>('/api/v1/access_guide'),

  getMyPayAccess: () =>
    fetchApi<{ enabled_for_all: boolean; enabled_user_ids: number[] }>('/api/v1/admin/my_pay_access'),

  setMyPayForEveryone: (enabledForAll: boolean) =>
    fetchApi<{ enabled_for_all: boolean; enabled_user_ids: number[] }>('/api/v1/admin/my_pay_access', {
      method: 'PATCH',
      body: JSON.stringify({ enabled_for_all: enabledForAll }),
    }),

  setUserMyPay: (id: number, enabled: boolean) =>
    fetchApi<{ user_id: number; my_pay_enabled: boolean; my_pay_active: boolean }>(`/api/v1/admin/users/${id}/my_pay`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled }),
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

  getTimeEntry: (id: number) => fetchApi<{ time_entry: TimeEntry }>(`/api/v1/time_entries/${id}`),

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
    review_action: 'end_clock' | 'resubmit_denied';
    expected_version: number;
    stop_date: string;
    work_date: string;
    start_time: string;
    end_time: string;
    description: string;
    time_category_id: number;
    break_minutes: number | null;
    breaks: Array<{ id?: number; start_time: string; end_time: string; _destroy?: boolean }>;
  }>, correctionReason?: string) =>
    fetchApi<{ time_entry: TimeEntry }>(`/api/v1/time_entries/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ time_entry: data, correction_reason: correctionReason }),
    }),

  deleteTimeEntry: (id: number, correctionReason?: string) =>
    fetchApi<void>(`/api/v1/time_entries/${id}`, {
      method: 'DELETE',
      body: JSON.stringify({ correction_reason: correctionReason }),
    }),

  // Time Clock
  clockIn: (userId?: number, adminOverride?: boolean, timeCategoryId?: number, location?: ClockLocationPayload) =>
    fetchApi<{ time_entry: TimeEntry }>('/api/v1/time_entries/clock_in', {
      method: 'POST',
      body: JSON.stringify({
        ...(userId ? { user_id: userId } : {}),
        ...(adminOverride ? { admin_override: true } : {}),
        ...(timeCategoryId ? { time_category_id: timeCategoryId } : {}),
        ...(location ? { location } : {}),
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

  getPendingApprovals: (params?: ApprovalGroupFilter | PendingApprovalsParams) => {
    const searchParams = new URLSearchParams();
    const normalizedParams: PendingApprovalsParams = typeof params === 'string' ? { approval_group: params } : (params ?? {});

    if (normalizedParams.approval_group) searchParams.set('approval_group', normalizedParams.approval_group);
    if (normalizedParams.date) searchParams.set('date', normalizedParams.date);
    if (normalizedParams.start_date) searchParams.set('start_date', normalizedParams.start_date);
    if (normalizedParams.end_date) searchParams.set('end_date', normalizedParams.end_date);
    if (normalizedParams.through_date) searchParams.set('through_date', normalizedParams.through_date);
    if (normalizedParams.since_date) searchParams.set('since_date', normalizedParams.since_date);
    if (normalizedParams.user_id) searchParams.set('user_id', normalizedParams.user_id.toString());
    if (normalizedParams.time_category_id) searchParams.set('time_category_id', normalizedParams.time_category_id.toString());
    if (normalizedParams.approval_type) searchParams.set('approval_type', normalizedParams.approval_type);
    if (normalizedParams.entry_method) searchParams.set('entry_method', normalizedParams.entry_method);
    if (normalizedParams.clock_source) searchParams.set('clock_source', normalizedParams.clock_source);
    if (normalizedParams.sort) searchParams.set('sort', normalizedParams.sort);
    if (normalizedParams.direction) searchParams.set('direction', normalizedParams.direction);
    if (normalizedParams.page) searchParams.set('page', normalizedParams.page.toString());
    if (normalizedParams.per_page) searchParams.set('per_page', normalizedParams.per_page.toString());

    const query = searchParams.toString();
    return fetchApi<PendingApprovalsResponse>(`/api/v1/time_entries/pending_approvals${query ? `?${query}` : ''}`);
  },

  getWhosWorking: () =>
    fetchApi<{ workers: WorkerStatus[] }>('/api/v1/time_entries/whos_working'),

  approveTimeEntry: (id: number, note?: string, options?: { includeOvertime: boolean }) =>
    fetchApi<{ time_entry: TimeEntry }>(`/api/v1/time_entries/${id}/approve`, {
      method: 'POST',
      body: JSON.stringify(options?.includeOvertime ? { note, include_overtime: true } : { note }),
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

  getHoursReport: (params: HoursReportParams) => {
    const searchParams = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') searchParams.set(key, String(value));
    });
    return fetchApi<HoursReportResponse>(`/api/v1/admin/hours_report?${searchParams.toString()}`);
  },

  downloadHoursReport: (
    type: HoursReportDownloadType,
    params: HoursReportParams,
    acknowledgeDraft: boolean = false
  ) => {
    const searchParams = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') searchParams.set(key, String(value));
    });
    if (acknowledgeDraft) searchParams.set('acknowledge_draft', 'true');
    return fetchDownload(`/api/v1/admin/hours_report/${type}?${searchParams.toString()}`);
  },

  getLeaveRequests: (status?: LeaveRequestQueryStatus, page: number = 1, perPage: number = 25) => {
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    params.set('page', String(page));
    params.set('per_page', String(perPage));
    const query = params.toString();
    return fetchApi<{ leave_requests: LeaveRequest[]; pagination: PaginationMeta }>(`/api/v1/leave_requests?${query}`);
  },

  createLeaveRequest: (payload: Pick<LeaveRequest, 'leave_type' | 'start_date' | 'end_date'> & { reason?: string }) =>
    fetchApi<{ leave_request: LeaveRequest }>('/api/v1/leave_requests', {
      method: 'POST',
      body: JSON.stringify({ leave_request: payload }),
    }),

  approveLeaveRequest: (id: number, reviewNote?: string) =>
    fetchApi<{ leave_request: LeaveRequest }>(`/api/v1/leave_requests/${id}/approve`, {
      method: 'POST',
      body: JSON.stringify({ review_note: reviewNote }),
    }),

  declineLeaveRequest: (id: number, reviewNote?: string) =>
    fetchApi<{ leave_request: LeaveRequest }>(`/api/v1/leave_requests/${id}/decline`, {
      method: 'POST',
      body: JSON.stringify({ review_note: reviewNote }),
    }),

  cancelLeaveRequest: (id: number) =>
    fetchApi<{ leave_request: LeaveRequest }>(`/api/v1/leave_requests/${id}/cancel`, {
      method: 'POST',
    }),

  createAdminKioskSession: () =>
    fetchApi<KioskSessionResponse>('/api/v1/admin/kiosk_session', {
      method: 'POST',
    }),

  // Time Categories
  getTimeCategories: () =>
    fetchApi<{ time_categories: TimeCategory[] }>('/api/v1/time_categories'),

  getAdminTimeCategories: () =>
    fetchApi<{ time_categories: AdminTimeCategory[] }>('/api/v1/admin/time_categories'),

  getAdminAppSettings: () =>
    fetchApi<AdminAppSettingsResponse>('/api/v1/admin/settings'),

  geocodeAdminClockLocation: (query: string) =>
    fetchApi<{ results: GeocodeResult[] }>(`/api/v1/admin/settings/geocode?query=${encodeURIComponent(query)}`),

  autocompleteAdminClockLocation: (query: string, sessionToken: string) =>
    fetchApi<{ suggestions: PlaceAutocompleteSuggestion[] }>(
      `/api/v1/admin/settings/place_autocomplete?query=${encodeURIComponent(query)}&session_token=${encodeURIComponent(sessionToken)}`
    ),

  getAdminClockPlaceDetails: (placeId: string, sessionToken: string) =>
    fetchApi<{ place: PlaceDetails }>(
      `/api/v1/admin/settings/place_details?place_id=${encodeURIComponent(placeId)}&session_token=${encodeURIComponent(sessionToken)}`
    ),

  updateAdminAppSettings: (payload: { settings?: Partial<TimeClockAppSettings>; approval_groups?: ApprovalGroupOption[] }) =>
    fetchApi<AdminAppSettingsResponse>('/api/v1/admin/settings', {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  getAdminContactSettings: () =>
    fetchApi<ContactSettings>('/api/v1/admin/contact_settings'),

  updateAdminContactSettings: (settings: ContactSettings) =>
    fetchApi<ContactSettings & { message: string }>('/api/v1/admin/contact_settings', {
      method: 'PATCH',
      body: JSON.stringify(settings),
    }),

  getAdminSiteMedia: () =>
    fetchApi<{ site_media: SiteMedia[] }>('/api/v1/admin/site-media'),

  createSiteMedia: (input: SiteMediaInput) =>
    fetchApiUpload<{ site_media: SiteMedia }>('/api/v1/admin/site-media', siteMediaFormData(input)),

  updateSiteMedia: (id: number, input: SiteMediaInput) =>
    fetchApiUpload<{ site_media: SiteMedia }>(`/api/v1/admin/site-media/${id}`, siteMediaFormData(input), { method: 'PATCH' }),

  deleteSiteMedia: (id: number) =>
    fetchApi<void>(`/api/v1/admin/site-media/${id}`, {
      method: 'DELETE',
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

  // Activity history
  getAuditLog: (id: number) => fetchApi<AuditLogEntry>(`/api/v1/admin/audit_logs/${id}`),

  getAuditLogs: (filters: AuditLogFilters = {}) => {
    const searchParams = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== '') searchParams.set(key, String(value));
    });
    const query = searchParams.toString();
    return fetchApi<AuditLogResponse>(`/api/v1/admin/audit_logs${query ? `?${query}` : ''}`);
  },

  downloadAuditLogs: (filters: AuditLogFilters = {}) => {
    const searchParams = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== '' && key !== 'page' && key !== 'per_page') searchParams.set(key, String(value));
    });
    const query = searchParams.toString();
    return fetchDownload(`/api/v1/admin/audit_logs/export${query ? `?${query}` : ''}`);
  },

  // Finalized payroll batches
  getPayrollBatches: () =>
    fetchApi<{ connected_payroll?: ConnectedPayrollCapability; payroll_batches: PayrollBatchListItem[]; total_count: number; truncated: boolean }>('/api/v1/admin/payroll_batches'),

  getPayrollCarryovers: () =>
    fetchApi<PayrollCarryoverQueue>('/api/v1/admin/payroll_batches/carryovers'),

  getPayrollBatch: (id: string) =>
    fetchApi<PayrollBatchDetail>(`/api/v1/admin/payroll_batches/${encodeURIComponent(id)}`),

  previewPayrollBatch: (startDate: string, endDate: string, cutoffAt?: string, manualProcessing = false) =>
    fetchApi<PayrollBatchPayload>('/api/v1/admin/payroll_batches/preview', {
      method: 'POST',
      body: JSON.stringify({ start_date: startDate, end_date: endDate, cutoff_at: cutoffAt, manual_processing: manualProcessing }),
    }),

  finalizePayrollBatch: (payload: {
    start_date: string;
    end_date: string;
    acknowledge_negative_adjustments?: boolean;
    negative_adjustment_note?: string;
    manual_processing?: boolean;
  } & Partial<ManualPayrollProcessingInput>) => fetchApi<PayrollBatchDetail>('/api/v1/admin/payroll_batches', {
    method: 'POST',
    body: JSON.stringify(payload),
  }),

  downloadPayrollBatch: (id: string) =>
    fetchDownload(`/api/v1/admin/payroll_batches/${encodeURIComponent(id)}/export`),

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

  getSchedule: (id: number) =>
    fetchApi<{ schedule: Schedule }>(`/api/v1/schedules/${id}`),

  getMySchedule: () =>
    fetchApi<{ schedules: Schedule[] }>('/api/v1/schedules/my_schedule'),

  createSchedule: (data: {
    user_id: number;
    work_date: string;
    start_time: string;
    end_time: string;
    notes?: string;
    acknowledge_leave_conflict?: boolean;
    leave_conflict_reason?: string;
    acknowledged_leave_ids?: number[];
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
    acknowledge_leave_conflict?: boolean;
    leave_conflict_reason?: string;
    acknowledged_leave_ids?: number[];
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
    acknowledge_leave_conflict: boolean;
    leave_conflict_reason: string;
    acknowledged_leave_ids: number[];
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
