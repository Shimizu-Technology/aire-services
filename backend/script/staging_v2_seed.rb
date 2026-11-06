# frozen_string_literal: true

require "digest"

unless Rails.env.production? &&
       ENV["DEPLOYMENT_ENV"] == "staging" &&
       ENV["STAGING_SEED_ALLOWED"] == "true" &&
       ENV["STAGING_FIXTURE_NAMESPACE"] == "staging-v2"
  abort "Refusing to seed outside the explicit AIRE staging v2 deployment"
end

database_name = ActiveRecord::Base.connection_db_config.database.to_s
abort "Refusing to seed an unexpected database" unless database_name == "aire_services_staging_v2"

marker_key = "aire_payroll_staging_v2_fixture_version"
if Setting.find_by(key: marker_key)&.value == "2"
  puts "AIRE staging v2 fixture already exists"
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

periods = (-4..2).flat_map do |offset|
  reference = now.to_date.advance(months: offset)
  [ period_for.call(reference.change(day: 1)), period_for.call(reference.change(day: 16)) ]
end.uniq.sort_by(&:first)

pay_date_for = lambda do |(_start_date, end_date)|
  end_date.day == 15 ? end_date.end_of_month : end_date.next_month.change(day: 15)
end
cutoff_for_index = lambda do |index|
  previous_pay_date = pay_date_for.call(periods.fetch(index - 1))
  cutoff_date = previous_pay_date + 7.days
  guam.local(cutoff_date.year, cutoff_date.month, cutoff_date.day, 17, 0)
end

manual_index = (1...(periods.length - 1)).find do |index|
  cutoff_for_index.call(index) <= now && cutoff_for_index.call(index + 1) > now
end
abort "No adjacent finalized and upcoming staging v2 periods are available" unless manual_index

context_dates = periods.fetch(manual_index - 1)
manual_dates = periods.fetch(manual_index)
connected_dates = periods.fetch(manual_index + 1)

admin_clerk_id = ENV.fetch("AIRE_STAGING_ADMIN_CLERK_ID")
admin_email = ENV.fetch("STAGING_ADMIN_EMAIL")

ApplicationRecord.transaction do
  admin = User.create!(
    id: 910_001,
    email: admin_email,
    clerk_id: admin_clerk_id,
    first_name: "Chels",
    last_name: "Staging v2",
    role: "admin",
    is_active: true,
    personal_access_enabled: true,
    profile_source: "clerk",
    time_tracking_enabled: false,
    kiosk_enabled: false
  )
  ari = User.create!(
    id: 910_101,
    email: "ari.reconciliation.v2@example.test",
    clerk_id: "staging_v2_ari_reconciliation",
    payroll_integration_uuid: "00000000-0000-4000-8000-000000000111",
    first_name: "Ari",
    last_name: "Reconciliation",
    role: "employee",
    is_active: true,
    personal_access_enabled: false,
    profile_source: "local",
    time_tracking_enabled: true,
    kiosk_enabled: true,
    kiosk_pin: "0111"
  )
  casey = User.create!(
    id: 910_102,
    email: "casey.connected.v2@example.test",
    clerk_id: "staging_v2_casey_connected",
    payroll_integration_uuid: "00000000-0000-4000-8000-000000000112",
    first_name: "Casey",
    last_name: "Connected",
    role: "employee",
    is_active: true,
    personal_access_enabled: false,
    profile_source: "local",
    time_tracking_enabled: true,
    kiosk_enabled: true,
    kiosk_pin: "0112"
  )

  reconciliation_category = TimeCategory.create!(
    id: 910_101,
    name: "Staging v2 Reconciliation",
    key: "staging_v2_reconciliation",
    description: "Synthetic staging v2 finalized payroll hours",
    hourly_rate_cents: 2_500,
    is_active: true
  )
  connected_category = TimeCategory.create!(
    id: 910_102,
    name: "Staging v2 Connected Operations",
    key: "staging_v2_connected_operations",
    description: "Synthetic staging v2 connected payroll hours",
    hourly_rate_cents: 2_000,
    is_active: true
  )
  UserTimeCategory.create!(user: ari, time_category: reconciliation_category, hourly_rate_cents: 2_500)
  UserTimeCategory.create!(user: casey, time_category: connected_category, hourly_rate_cents: 2_000)

  create_entry = lambda do |user:, category:, work_date:, start_hour:, hours:, method:, approval:, overtime:, description:, timestamp:|
    entry = TimeEntry.create!(
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
    # This empty-database staging fixture simulates historical events. Explicit
    # synthetic revisions provide its authored timeline; production backfills
    # must retain their real recorded_at and cannot claim past cutoff evidence.
    captured = PayrollTimeEntryRevision.where(source_time_entry_id: entry.id).order(:id).last
    PayrollTimeEntryRevision.create!(
      captured.attributes.except("id").merge(
        "recorded_at" => [ timestamp, entry.approved_at, entry.overtime_approved_at ].compact.max,
        "snapshot" => captured.snapshot.merge("synthetic_fixture" => true)
      )
    )
    entry
  end

  manual_start, manual_end = manual_dates
  manual_cutoff = cutoff_for_index.call(manual_index)
  before_cutoff = manual_cutoff - 1.day
  create_entry.call(
    user: ari, category: reconciliation_category, work_date: manual_start, start_hour: 8, hours: 8,
    method: "clock", approval: nil, overtime: "none",
    description: "Included before the regular-run cutoff", timestamp: before_cutoff
  )
  create_entry.call(
    user: ari, category: reconciliation_category, work_date: manual_start, start_hour: 16, hours: 2,
    method: "manual", approval: "approved", overtime: "approved",
    description: "Approved additional regular hours included before cutoff", timestamp: before_cutoff
  )
  create_entry.call(
    user: ari, category: reconciliation_category, work_date: manual_end, start_hour: 8, hours: 4,
    method: "manual", approval: "pending", overtime: "none",
    description: "Entered after cutoff and held for the following run", timestamp: manual_cutoff + 1.hour
  )

  connected_start, connected_end = connected_dates
  if connected_start <= now.to_date
    connected_work_date = [ now.to_date, connected_end ].min
    live_timestamp = [ now - 2.hours, cutoff_for_index.call(manual_index) + 1.hour ].max
    create_entry.call(
      user: casey, category: connected_category, work_date: connected_work_date, start_hour: 7, hours: 10,
      method: "clock", approval: nil, overtime: "approved",
      description: "Connected-flow long day below the weekly overtime threshold", timestamp: live_timestamp
    )
    create_entry.call(
      user: casey, category: connected_category, work_date: connected_work_date, start_hour: 17, hours: 2,
      method: "manual", approval: "pending", overtime: "none",
      description: "Pending connected hours", timestamp: live_timestamp
    )
  end

  build_period = lambda do |id:, index:|
    start_date, end_date = periods.fetch(index)
    pay_date = pay_date_for.call(periods.fetch(index))
    previous_regular_pay_date = pay_date_for.call(periods.fetch(index - 1))
    cutoff_at = cutoff_for_index.call(index)
    external_pay_period_id = format("00000000-0000-4000-8000-%012d", id)
    publication_id = format("00000000-0000-4000-9000-%012d", id)
    checksum = Digest::SHA256.hexdigest(
      [ start_date, end_date, pay_date, previous_regular_pay_date, cutoff_at.iso8601, id ].join("|")
    )
    PayrollCalendarPeriod.create!(
      id: id,
      schema_version: "2.0",
      external_pay_period_id: external_pay_period_id,
      start_date: start_date,
      end_date: end_date,
      pay_date: pay_date,
      cutoff_at: cutoff_at,
      time_zone: "Pacific/Guam",
      cutoff_rule: "after_previous_regular_payday",
      cutoff_days: 7,
      previous_regular_pay_date: previous_regular_pay_date,
      schedule_version: 1,
      publication_id: publication_id,
      request_checksum: checksum,
      status: "scheduled",
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

  manual_period = build_period.call(id: 910_001, index: manual_index)
  build_period.call(id: 910_002, index: manual_index + 1)

  PayrollAccountLink.create!(
    user: admin,
    external_system: PayrollAccountLink::EXTERNAL_SYSTEM,
    external_actor_id: "910001",
    external_actor_email: admin_email,
    linked_at: now - 1.day,
    active: true
  )

  result = Payroll::ScheduledCutoffFinalizer.new(period_id: manual_period.id, now: now).call
  abort "Unable to finalize the staging v2 reconciliation period: #{result.inspect}" unless result.fetch(:status) == "finalized"

  Setting.create!(
    key: marker_key,
    value: "2",
    description: "Marks the isolated AIRE/Cornerstone staging v2 fixture"
  )
end

puts "Seeded AIRE staging v2 fixture: reconciliation period #{manual_dates.join('..')}, connected period #{connected_dates.join('..')}"
