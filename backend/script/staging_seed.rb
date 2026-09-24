# frozen_string_literal: true

require "digest"
require "securerandom"

unless Rails.env.production? && ENV["DEPLOYMENT_ENV"] == "staging" && ENV["STAGING_SEED_ALLOWED"] == "true"
  abort "Refusing to seed outside the explicit AIRE staging deployment"
end

database_name = ActiveRecord::Base.connection_db_config.database.to_s
abort "Refusing to seed an unexpected database" unless database_name == "aire_services_staging"

marker_key = "aire_payroll_staging_fixture_version"
if Setting.find_by(key: marker_key)&.value == "1"
  puts "AIRE staging fixture already exists"
  exit
end

guam = ActiveSupport::TimeZone["Pacific/Guam"]
now = guam.now

period_for = lambda do |date|
  if date.day <= 15
    [ date.beginning_of_month, date.change(day: 15) ]
  else
    [ date.change(day: 16), date.end_of_month ]
  end
end

periods = (-4..1).map do |offset|
  reference = now.to_date.advance(months: offset)
  [ period_for.call(reference.change(day: 1)), period_for.call(reference.change(day: 16)) ]
end.flatten(1).uniq.sort_by(&:first)

manual_dates = periods.select do |(_start_date, end_date)|
  pay_date = end_date + 1.day
  cutoff_date = pay_date + 7.days
  guam.local(cutoff_date.year, cutoff_date.month, cutoff_date.day, 17, 0) < now
end.last or abort "No completed semimonthly staging period is available"

manual_index = periods.index(manual_dates)
connected_dates = periods.fetch(manual_index + 1)

cutoff_for = lambda do |end_date|
  pay_date = end_date + 1.day
  cutoff_date = pay_date + 7.days
  guam.local(cutoff_date.year, cutoff_date.month, cutoff_date.day, 17, 0)
end

admin_clerk_id = ENV.fetch("AIRE_STAGING_ADMIN_CLERK_ID")
admin_email = ENV.fetch("STAGING_ADMIN_EMAIL")

ApplicationRecord.transaction do
  admin = User.create!(
    id: 900_001,
    email: admin_email,
    clerk_id: admin_clerk_id,
    first_name: "Chels",
    last_name: "Staging",
    role: "admin",
    is_active: true,
    personal_access_enabled: true,
    profile_source: "clerk",
    time_tracking_enabled: false,
    kiosk_enabled: false
  )
  ari = User.create!(
    id: 900_101,
    email: "ari.manual@example.test",
    clerk_id: "staging_ari_manual",
    payroll_integration_uuid: "00000000-0000-4000-8000-000000000101",
    first_name: "Ari",
    last_name: "Manual",
    role: "employee",
    is_active: true,
    personal_access_enabled: false,
    profile_source: "local",
    time_tracking_enabled: true,
    kiosk_enabled: true,
    kiosk_pin: "0101"
  )
  casey = User.create!(
    id: 900_102,
    email: "casey.connected@example.test",
    clerk_id: "staging_casey_connected",
    payroll_integration_uuid: "00000000-0000-4000-8000-000000000102",
    first_name: "Casey",
    last_name: "Connected",
    role: "employee",
    is_active: true,
    personal_access_enabled: false,
    profile_source: "local",
    time_tracking_enabled: true,
    kiosk_enabled: true,
    kiosk_pin: "0102"
  )

  manual_category = TimeCategory.create!(
    id: 900_101,
    name: "Staging Manual Operations",
    key: "staging_manual_operations",
    description: "Synthetic staging-only manual payroll hours",
    hourly_rate_cents: 2_500,
    is_active: true
  )
  connected_category = TimeCategory.create!(
    id: 900_102,
    name: "Staging Connected Operations",
    key: "staging_connected_operations",
    description: "Synthetic staging-only connected payroll hours",
    hourly_rate_cents: 2_000,
    is_active: true
  )
  UserTimeCategory.create!(user: ari, time_category: manual_category, hourly_rate_cents: 2_500)
  UserTimeCategory.create!(user: casey, time_category: connected_category, hourly_rate_cents: 2_000)

  create_entry = lambda do |user:, category:, work_date:, start_hour:, hours:, method:, approval:, overtime:, description:, timestamp:|
    TimeEntry.create!(
      user: user,
      time_category: category,
      work_date: work_date,
      status: "completed",
      entry_method: method,
      clock_source: method == "clock" ? "kiosk" : "admin",
      approval_status: approval,
      approved_by: approval == "approved" ? admin : nil,
      approved_at: approval == "approved" ? timestamp + 1.hour : nil,
      overtime_status: overtime,
      overtime_approved_by: overtime == "approved" ? admin : nil,
      overtime_approved_at: overtime == "approved" ? timestamp + 2.hours : nil,
      start_time: guam.local(work_date.year, work_date.month, work_date.day, start_hour, 0),
      end_time: guam.local(work_date.year, work_date.month, work_date.day, start_hour + hours, 0),
      break_minutes: 0,
      description: description,
      created_at: timestamp,
      updated_at: timestamp
    )
  end

  manual_start, manual_end = manual_dates
  manual_cutoff = cutoff_for.call(manual_end)
  old_timestamp = manual_cutoff - 1.day
  create_entry.call(
    user: ari, category: manual_category, work_date: manual_start, start_hour: 8, hours: 8,
    method: "clock", approval: nil, overtime: "none",
    description: "Manual-flow ordinary hours", timestamp: old_timestamp
  )
  create_entry.call(
    user: ari, category: manual_category, work_date: manual_start, start_hour: 16, hours: 2,
    method: "manual", approval: "approved", overtime: "approved",
    description: "Manual-flow approved overtime", timestamp: old_timestamp
  )
  create_entry.call(
    user: ari, category: manual_category, work_date: manual_start + 1.day, start_hour: 8, hours: 4,
    method: "manual", approval: "pending", overtime: "none",
    description: "Held for a later payroll", timestamp: old_timestamp
  )

  connected_start, connected_end = connected_dates
  live_timestamp = [ now - 2.hours, cutoff_for.call(manual_end) + 1.hour ].max
  create_entry.call(
    user: casey, category: connected_category, work_date: connected_start, start_hour: 7, hours: 10,
    method: "clock", approval: nil, overtime: "approved",
    description: "Connected-flow day with overtime", timestamp: live_timestamp
  )
  create_entry.call(
    user: casey, category: connected_category, work_date: connected_start + 1.day, start_hour: 8, hours: 6,
    method: "clock", approval: nil, overtime: "none",
    description: "Connected-flow regular hours", timestamp: live_timestamp
  )

  build_period = lambda do |id:, dates:, status:|
    start_date, end_date = dates
    pay_date = end_date + 1.day
    cutoff_at = cutoff_for.call(end_date)
    external_pay_period_id = format("00000000-0000-4000-8000-%012d", id)
    publication_id = format("00000000-0000-4000-9000-%012d", id)
    checksum = Digest::SHA256.hexdigest([ start_date, end_date, pay_date, cutoff_at.iso8601, id ].join("|"))
    PayrollCalendarPeriod.create!(
      id: id,
      external_pay_period_id: external_pay_period_id,
      start_date: start_date,
      end_date: end_date,
      pay_date: pay_date,
      cutoff_at: cutoff_at,
      time_zone: "Pacific/Guam",
      cutoff_policy: "after_regular_pay_date",
      cutoff_days_before: 7,
      cutoff_days_after_pay_date: 7,
      schedule_version: 1,
      publication_id: publication_id,
      request_checksum: checksum,
      status: status,
      next_finalization_attempt_at: cutoff_at
    ).tap do |period|
      period.payroll_calendar_period_revisions.create!(
        schedule_version: 1,
        publication_id: publication_id,
        request_checksum: checksum,
        payload: period.as_contract_json,
        published_at: [ cutoff_at - 8.days, now ].min
      )
    end
  end

  manual_period = build_period.call(id: 900_001, dates: manual_dates, status: "scheduled")
  build_period.call(id: 900_002, dates: connected_dates, status: "scheduled")

  PayrollAccountLink.create!(
    user: admin,
    external_system: PayrollAccountLink::EXTERNAL_SYSTEM,
    external_actor_id: "900001",
    external_actor_email: admin_email,
    linked_at: now - 1.day,
    active: true
  )

  result = Payroll::ScheduledCutoffFinalizer.new(period_id: manual_period.id, now: now).call
  abort "Unable to finalize the manual staging period: #{result.inspect}" unless result.fetch(:status) == "finalized"

  Setting.create!(
    key: marker_key,
    value: "1",
    description: "Marks the isolated AIRE/Cornerstone staging fixture"
  )
end

puts "Seeded AIRE staging fixture: manual period #{manual_dates.join('..')}, connected period #{connected_dates.join('..')}"
