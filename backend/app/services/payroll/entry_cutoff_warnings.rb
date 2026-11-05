# frozen_string_literal: true

require "set"

module Payroll
  # Display-only context from the published scheduled locks. This does not
  # approve time, change a lock, or choose a late-hours destination.
  class EntryCutoffWarnings
    def self.call(entries, now: Time.current)
      entries = entries.to_a
      return Set.new if entries.empty?

      dates = entries.map(&:work_date)
      periods = PayrollCalendarPeriod.scheduled_locks.where(cutoff_at: ..now)
        .where("start_date <= ? AND end_date >= ?", dates.max, dates.min)
        .pluck(:start_date, :end_date)
      entries.select { |entry| periods.any? { |starts_on, ends_on| entry.work_date.between?(starts_on, ends_on) } }.map(&:id).to_set
    end
  end
end
