# frozen_string_literal: true

require_relative "payroll_clock_helpers"

# A published scheduled period that has already ended in Guam but whose policy
# cutoff is still two days ahead, so lock now and moving the lock both apply.
# Dates are relative to the database clock: the cutoff guard trigger compares
# against PostgreSQL time, which travel_to does not move.
module PayrollCutoffOverrideHelpers
  GUAM = ActiveSupport::TimeZone["Pacific/Guam"]

  def ended_period_dates(today = PayrollClockHelpers.database_clock.to_date)
    end_date = today.day > 15 ? today.change(day: 15) : today.prev_month.end_of_month
    start_date = end_date.day == 15 ? end_date.beginning_of_month : end_date.change(day: 16)
    pay_date = today + 9
    { start_date: start_date, end_date: end_date, pay_date: pay_date }
  end

  def policy_publication(dates = ended_period_dates, version: 1, external_id: "6c6f636b-0000-4000-8000-000000000001", **extra)
    cutoff_date = dates.fetch(:pay_date) - 7
    {
      schema_version: "2.0",
      external_pay_period_id: external_id,
      start_date: dates.fetch(:start_date).iso8601,
      end_date: dates.fetch(:end_date).iso8601,
      pay_date: dates.fetch(:pay_date).iso8601,
      cutoff_at: GUAM.local(cutoff_date.year, cutoff_date.month, cutoff_date.day, 17).iso8601,
      time_zone: "Pacific/Guam",
      cutoff_rule: "before_pay_date",
      cutoff_days: 7,
      lock_mode: "scheduled",
      cutoff_enforcement_starts_on: PayrollLockRollout.installation.cutoff_enforcement_starts_on.iso8601,
      overtime_policy: Payroll::WeeklyOvertimeAllocator.configured_policy,
      schedule_version: version,
      publication_id: SecureRandom.uuid
    }.merge(extra)
  end

  def override_publication(base, cutoff_at:, action: "change", reason: "Payday moved for the holiday", version: 2, **extra)
    base.merge(
      schedule_version: version,
      publication_id: SecureRandom.uuid,
      cutoff_at: cutoff_at.iso8601,
      cutoff_source: "override",
      policy_cutoff_at: base.fetch(:cutoff_at),
      cutoff_override: {
        override_id: SecureRandom.uuid,
        action: action,
        reason: reason,
        set_at: Time.current.iso8601,
        set_by: { name: "Chels", system: "cornerstone_payroll", role: "org_admin" },
        previous_cutoff_at: base.fetch(:cutoff_at)
      }
    ).merge(extra)
  end

  def configure_lock_rollout!(dates = ended_period_dates)
    PayrollLockRollout.configure!(starts_on: dates.fetch(:start_date).iso8601, actor: "test operator", reason: "Approved test rollout")
  end
end
