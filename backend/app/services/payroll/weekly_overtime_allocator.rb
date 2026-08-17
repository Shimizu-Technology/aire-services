# frozen_string_literal: true

module Payroll
  class WeeklyOvertimeAllocator
    STATUTORY_WEEKLY_THRESHOLD = 40.0
    BUSINESS_TIMEZONE = TimeClockService::BUSINESS_TIMEZONE

    def self.call(entries)
      allocations = {}
      entries.group_by { |entry| entry.work_date.beginning_of_week(:sunday) }.each_value do |week_entries|
        cumulative = 0.0
        week_entries.sort_by { |entry| sort_key(entry) }.each do |entry|
          hours = entry.hours.to_f
          regular = [ [ STATUTORY_WEEKLY_THRESHOLD - cumulative, 0.0 ].max, hours ].min
          overtime = [ hours - regular, 0.0 ].max
          allocations[entry.id] = {
            regular_hours: round_hours(regular),
            overtime_hours: round_hours(overtime),
            weekly_cumulative_before: round_hours(cumulative),
            weekly_cumulative_after: round_hours(cumulative + hours)
          }
          cumulative += hours
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
