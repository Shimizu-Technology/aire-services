import type { PayrollCutoffResponse, PayrollLockControl, WorkerStatus } from '../../lib/api'
import type {
  AttentionItemData,
  AttentionPeriod,
  AttentionResponse,
  PayrollConnectionStatus,
} from '../../lib/api/attention'

// Wed, Nov 11, 2026 7:41 PM in Guam (UTC+10).
export const NOW = '2026-11-11T19:41:00+10:00'

const person = (id: number, full_name: string) => ({ id, full_name, display_name: full_name.split(' ')[0] })

export const caleb = person(7, 'Caleb Perez')
export const grace = person(8, 'Grace Torres')
export const ethan = person(9, 'Ethan Cruz')
export const rosa = person(10, 'Rosa Leon Guerrero')
export const kai = person(11, 'Kai Blas')

/** One of every attention item, in the API's order. */
export const allItems: AttentionItemData[] = [
  {
    key: 'open_clock_earlier_day:812', type: 'open_clock_earlier_day', tone: 'needs_fix', entry_id: 812, user: caleb,
    work_date: '2026-11-10', clock_in_at: '2026-11-10T07:02:00+10:00', status: 'clocked_in', hours_so_far: 36.7,
    time_category: { id: 3, name: 'Ground Operations' },
  },
  {
    key: 'long_clock_today:813', type: 'long_clock_today', tone: 'waiting', entry_id: 813, user: grace,
    work_date: '2026-11-11', clock_in_at: '2026-11-11T07:15:00+10:00', status: 'clocked_in', hours_so_far: 12.4,
    time_category: { id: 4, name: 'Flight Instruction' },
  },
  {
    key: 'approvals_waiting', type: 'approvals_waiting', tone: 'waiting', count: 31, total_hours: 276.06,
    oldest_work_date: '2026-11-06', by_kind: { time: 30, overtime: 1, added: 1, clocked: 30 },
  },
  {
    key: 'overtime_waiting', type: 'overtime_waiting', tone: 'waiting', count: 1, hours: 6, hours_complete: true,
    unprojected_count: 0, people: [{ ...ethan, hours: 6, entry_count: 1, week_starts: ['2026-11-01'] }],
  },
  {
    key: 'missing_category', type: 'missing_category', tone: 'needs_fix', count: 2, entry_ids: [901, 902],
    period: { start_date: '2026-11-01', end_date: '2026-11-15' },
  },
  {
    key: 'payroll_problem:lock_failed', type: 'payroll_problem', tone: 'needs_fix', problem: 'lock_failed',
    period: { id: 7, start_date: '2026-11-01', end_date: '2026-11-15' }, lock_mode: 'scheduled',
  },
  {
    key: 'leave_waiting', type: 'leave_waiting', tone: 'waiting', count: 5,
    next: { id: 4, user: rosa, leave_type: 'sick', start_date: '2026-11-12', end_date: '2026-11-12' },
  },
  { key: 'kiosk_pin_locked:11', type: 'kiosk_pin_locked', tone: 'info', user: kai, locked_until: '2026-11-11T21:40:00+10:00' },
  { key: 'pay_stub_requests', type: 'pay_stub_requests', tone: 'waiting', count: 1, oldest_requested_at: '2026-11-10T09:00:00+10:00' },
]

export const period: AttentionPeriod = {
  published: true, start_date: '2026-11-01', end_date: '2026-11-15', pay_date: '2026-11-25',
  cutoff_at: '2026-11-18T17:00:00+10:00', handoff_state: 'open', label: 'Open', label_provisional: true, people: 30,
  approved_hours: 1005, waiting_hours: 276.06, waiting_count: 31, hours_source: 'live',
}

export function attention(overrides: Partial<AttentionResponse> = {}): AttentionResponse {
  const items = overrides.items ?? allItems
  return {
    generated_at: NOW, time_zone: 'Pacific/Guam', today: '2026-11-11', count: items.length, items,
    approvals: null, period, connected_payroll: { mode: 'enabled', enabled: true, message: null },
    ...overrides,
  }
}

export function lockControl(overrides: Partial<PayrollLockControl> = {}): PayrollLockControl {
  return {
    period: { id: 7, external_pay_period_id: 'ext-7', start_date: '2026-11-01', end_date: '2026-11-15', pay_date: '2026-11-25' },
    publication_id: 'pub-1', schedule_version: 2, status: 'scheduled', cutoff_state: 'upcoming',
    cutoff_at: '2026-11-18T17:00:00+10:00', cutoff_source: 'policy', default_cutoff_at: '2026-11-18T17:00:00+10:00',
    override: null, earliest_cutoff_at: '2026-11-11T20:00:00+10:00', latest_cutoff_at: '2026-11-25T17:00:00+10:00',
    lock_now_available_at: '2026-11-11T20:00:00+10:00', can_change: true, can_lock_now: true, can_reset: false,
    pending_change: null, unavailable_reason: null,
    ...overrides,
  }
}

export function cutoff(control: PayrollLockControl | null = lockControl(), now = NOW): PayrollCutoffResponse {
  return {
    connected_payroll: { mode: 'enabled', enabled: true, message: null },
    cutoff: {
      period: null, publication_id: null, version: null, now, cutoff_at: null, seconds_remaining: null,
      time_zone: 'Pacific/Guam', stage: 'none',
    },
    lock_control: control,
  }
}

export function worker(overrides: Partial<WorkerStatus> & { id?: number; name?: string } = {}): WorkerStatus {
  const { id = 8, name = 'Grace Torres', ...rest } = overrides
  const base: WorkerStatus = {
    user: { id, full_name: name, display_name: name.split(' ')[0], email: `${id}@example.test` },
    schedule: null, status: 'clocked_in', clock_in_at: '2026-11-11T13:30:00+10:00', clock_out_at: null, completed_hours: 0,
    active_break: false, break_started_at: null, total_break_minutes: 0, breaks: [],
    time_category: { id: 4, name: 'Flight Instruction' }, open_since_work_date: null, open_entry_id: 1,
    ...rest,
  }
  // One open shift that matches the day's first clock-in, unless the test says otherwise.
  return {
    ...base,
    day_entries: rest.day_entries ?? [{
      id: 1, status: base.status, clock_in_at: base.clock_in_at, clock_out_at: null, hours: 0,
      time_category: base.time_category, breaks: base.breaks,
    }],
  }
}

export function connection(overrides: Partial<PayrollConnectionStatus> = {}): PayrollConnectionStatus {
  return {
    mode: 'enabled', enabled: true, message: null, state: 'connected',
    last_publication: { published_at: '2026-11-11T19:05:00+10:00', start_date: '2026-11-01', end_date: '2026-11-15' },
    last_delivery: {
      delivered_at: '2026-11-05T09:00:00+10:00', occurred_at: '2026-11-05T08:59:00+10:00',
      period: { start_date: '2026-10-16', end_date: '2026-10-31' },
    },
    undelivered: { count: 0, failed_count: 0, stuck_count: 0 },
    account_link: { linked_at: '2026-10-05T10:00:00+10:00', connected: true },
    ...overrides,
  }
}
