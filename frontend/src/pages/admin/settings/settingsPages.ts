export const settingsPages = {
  'time-clock': {
    title: 'Time clock rules',
    keys: ['overtime_daily_threshold_hours', 'overtime_weekly_threshold_hours', 'early_clock_in_buffer_minutes', 'clock_in_location_enforced', 'clock_in_location_name', 'clock_in_location_latitude', 'clock_in_location_longitude', 'clock_in_location_radius_meters'],
  },
  approvals: {
    title: 'Approvals',
    keys: ['managers_can_approve_own_time', 'auto_approve_ordinary_shifts', 'auto_approve_max_shift_hours', 'payroll_cutoff_reminder_emails'],
  },
  'pay-stubs': {
    title: 'Pay stubs',
    keys: ['pay_stub_kiosk_requests_enabled', 'pay_stub_self_email_enabled', 'pay_stub_request_notification_emails'],
  },
  kiosk: { title: 'Kiosk', keys: ['pay_stub_kiosk_requests_enabled'] },
  schedules: { title: 'Schedules', keys: ['schedules_enabled', 'schedule_required_for_clock_in'] },
} satisfies Record<string, { title: string; keys: string[] }>

export type SettingsPageId = keyof typeof settingsPages
