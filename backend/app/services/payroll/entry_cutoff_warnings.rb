# frozen_string_literal: true

require "set"

module Payroll
  # Display-only context from the published locks. This does not
  # approve time, change a lock, or choose a late-hours destination.
  class EntryCutoffWarnings
    def self.call(entries, now: Time.current)
      entries = entries.to_a
      return Set.new if entries.empty? || !ConnectedPayrollMode.enabled?

      dates = entries.map(&:work_date)
      scheduled = PayrollCalendarPeriod.scheduled_locks.where(cutoff_at: ..now)
      scope = PayrollCalendarPeriod.left_joins(:payroll_batch)
      manual = scope.where(lock_mode: "manual", status: "finalized").where("payroll_batches.cutoff_at <= ?", now)
      periods = scope.where(id: scheduled.select(:id)).or(manual)
        .where("payroll_calendar_periods.start_date <= ? AND payroll_calendar_periods.end_date >= ?", dates.max, dates.min)
        .pluck("payroll_calendar_periods.start_date", "payroll_calendar_periods.end_date")
      entries.select { |entry| periods.any? { |starts_on, ends_on| entry.work_date.between?(starts_on, ends_on) } }.map(&:id).to_set
    end
  end
end
