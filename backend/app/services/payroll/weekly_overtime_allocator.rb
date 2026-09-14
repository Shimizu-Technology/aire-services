# frozen_string_literal: true

module Payroll
  class WeeklyOvertimeAllocator
    STATUTORY_DAILY_THRESHOLD = 8.0
    STATUTORY_WEEKLY_THRESHOLD = 40.0
    BUSINESS_TIMEZONE = TimeClockService::BUSINESS_TIMEZONE

    def self.call(
      entries,
      daily_threshold: configured_threshold("overtime_daily_threshold_hours", STATUTORY_DAILY_THRESHOLD),
      weekly_threshold: configured_threshold("overtime_weekly_threshold_hours", STATUTORY_WEEKLY_THRESHOLD)
    )
      allocations = {}
      entries.group_by { |entry| entry.work_date.beginning_of_week(:sunday) }.each_value do |week_entries|
        weekly_cumulative = 0.0
        daily_cumulative = Hash.new(0.0)
        week_entries.sort_by { |entry| sort_key(entry) }.each do |entry|
          hours = entry.hours.to_f
          worked_today = daily_cumulative[entry.work_date]
          daily_regular_capacity = [ daily_threshold - worked_today, 0.0 ].max
          weekly_regular_capacity = [ weekly_threshold - weekly_cumulative, 0.0 ].max
          regular = [ hours, daily_regular_capacity, weekly_regular_capacity ].min
          overtime = [ hours - regular, 0.0 ].max
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

    def self.configured_threshold(key, fallback)
      value = Setting.get(key).to_f
      value.positive? ? value : fallback
    end
    private_class_method :configured_threshold

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
