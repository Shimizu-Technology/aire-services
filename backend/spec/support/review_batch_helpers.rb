# frozen_string_literal: true

# Shifts for the Approvals inbox specs. Times are Guam local; the default week
# is Sun Apr 5 – Sat Apr 11 2026, inside the Apr 1–15 pay period.
module ReviewBatchHelpers
  ZONE = ActiveSupport::TimeZone["Pacific/Guam"]

  def headers_for(user, key: nil)
    { "Authorization" => "Bearer test_token_#{user.id}" }.tap { |headers| headers["Idempotency-Key"] = key if key }
  end

  # A completed, unscheduled kiosk shift waiting for approval: ordinary unless
  # the attributes say otherwise.
  def clock_shift(user, date, from: 8, hours: 8, category: review_category, **attrs)
    start = ZONE.local(date.year, date.month, date.day, from)
    stop = start + hours.hours
    create(:time_entry, user: user, time_category: category, work_date: date, entry_method: "clock", clock_source: "kiosk",
      status: "completed", clock_in_at: start, clock_out_at: stop, start_time: start, end_time: stop, hours: hours,
      approval_status: "pending", approval_note: TimeClockService::UNSCHEDULED_NOTE, **attrs)
  end

  def item_for(entry, approve_time: true, approve_overtime: false, overtime_hours: nil)
    entry.reload
    { id: entry.id, version: entry.lock_version, approve_time: approve_time, approve_overtime: approve_overtime,
      overtime_hours: overtime_hours }.compact
  end

  def post_review_batch(user, items, key: SecureRandom.uuid, mode: nil)
    post "/api/v1/time_entries/review_batch", params: { items: items, mode: mode }.compact, headers: headers_for(user, key: key), as: :json
  end

  def protecting_export_for(entry)
    ReportExport.create!(
      public_id: "AIRE-PAYROLL-#{SecureRandom.hex(6).upcase}", export_type: "payroll_time_summary", readiness_status: "complete",
      state: "active", start_date: entry.work_date, end_date: entry.work_date, employee_ids: [ entry.user_id ],
      entry_ids: [ entry.id ], filters: {}, summary: {}, issues: {}, entry_snapshot: [ { id: entry.id, hours: entry.hours.to_f } ],
      checksum: SecureRandom.hex(16), protects_entries: true, generated_at: Time.current, last_downloaded_at: Time.current
    )
  end
end
