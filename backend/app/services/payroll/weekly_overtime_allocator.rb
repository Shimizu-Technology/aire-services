# frozen_string_literal: true

module Payroll
  class WeeklyOvertimeAllocator
    STATUTORY_WEEKLY_THRESHOLD = 40.0
    BUSINESS_TIMEZONE = TimeClockService::BUSINESS_TIMEZONE
    POLICY = {
      schema_version: "2.0",
      calculation: "weekly_only",
      weekly_threshold_hours: STATUTORY_WEEKLY_THRESHOLD,
      workweek_start: "sunday",
      time_zone: "Pacific/Guam"
    }.transform_values(&:freeze).freeze

    # Review-alert settings never change the payable overtime policy.
    def self.configured_policy
      POLICY.deep_dup
    end

    def self.supported_policy?(policy)
      policy.respond_to?(:stringify_keys) && policy.stringify_keys == POLICY.stringify_keys
    end

    def self.call(entries)
      allocations = {}
      entries.group_by { |entry| entry.work_date.beginning_of_week(:sunday) }.each_value do |week_entries|
        weekly_cumulative = 0.to_d
        daily_cumulative = Hash.new(0.to_d)
        week_entries.sort_by { |entry| sort_key(entry) }.each do |entry|
          hours = entry.hours.to_d
          worked_today = daily_cumulative[entry.work_date]
          weekly_regular_capacity = [ STATUTORY_WEEKLY_THRESHOLD.to_d - weekly_cumulative, 0.to_d ].max
          regular = [ hours, weekly_regular_capacity ].min
          overtime = [ hours - regular, 0.to_d ].max
          allocations[entry.id] = {
            regular_hours: round_hours(regular),
            overtime_hours: round_hours(overtime),
            daily_cumulative_before: round_hours(worked_today),
            daily_cumulative_after: round_hours(worked_today + hours),
            weekly_cumulative_before: round_hours(weekly_cumulative),
            weekly_cumulative_after: round_hours(weekly_cumulative + hours)
          }
          daily_cumulative[entry.work_date] += hours
          weekly_cumulative += hours
        end
      end
      allocations
    end

    def self.sort_key(entry)
      seconds = entry.start_time&.in_time_zone(BUSINESS_TIMEZONE)&.seconds_since_midnight || 0
      [ entry.work_date, seconds, entry.created_at, entry.id ]
    end
    private_class_method :sort_key

    def self.round_hours(value)
      BigDecimal(value.to_s).round(2).to_f
    end
    private_class_method :round_hours
  end
end
