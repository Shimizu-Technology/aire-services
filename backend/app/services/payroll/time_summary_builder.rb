# frozen_string_literal: true

module Payroll
  class TimeSummaryBuilder
    SOURCE = "aire_services"
    MAX_RANGE_DAYS = 62

    attr_reader :start_date, :end_date

    def initialize(start_date:, end_date:)
      @start_date = parse_date!(start_date, "start_date")
      @end_date = parse_date!(end_date, "end_date")
      raise ArgumentError, "end_date must be on or after start_date" if @end_date < @start_date
      raise ArgumentError, "date range may not exceed #{MAX_RANGE_DAYS} days" if (@end_date - @start_date).to_i > MAX_RANGE_DAYS
    end

    def call
      entries = entries_in_range.where.not(user_id: nil).includes(:time_category).to_a
      users = User.staff.includes(:user_approval_groups).where(id: entries.map(&:user_id).uniq).order(:last_name, :first_name, :email).to_a
      staff_user_ids = users.map(&:id)
      entries = entries.select { |entry| staff_user_ids.include?(entry.user_id) }
      entries_by_user_id = entries.group_by(&:user_id)
      overtime_entries_by_user_id = overtime_context_entries_for(staff_user_ids).group_by(&:user_id)

      employees = users.map do |user|
        serialize_user(user, entries_by_user_id.fetch(user.id, []), overtime_entries_by_user_id.fetch(user.id, []))
      end

      {
        source: SOURCE,
        start_date: start_date.iso8601,
        end_date: end_date.iso8601,
        generated_at: Time.current.iso8601,
        employees: employees,
        summary: summary(entries, employees)
      }
    end

    private

    def parse_date!(value, name)
      raise ArgumentError, "#{name} is required" if value.blank?
      Date.iso8601(value.to_s)
    rescue Date::Error
      raise ArgumentError, "#{name} must be a valid ISO 8601 date (YYYY-MM-DD)"
    end

    def entries_in_range
      TimeEntry.where(work_date: start_date..end_date)
    end

    def overtime_context_entries_for(user_ids)
      return [] if user_ids.blank?

      TimeEntry.where(
        user_id: user_ids,
        work_date: start_date.beginning_of_week(:sunday)..end_date.end_of_week(:sunday)
      ).to_a
    end

    def serialize_user(user, user_entries, overtime_entries)
      countable = user_entries.select { |entry| countable?(entry) }
      overtime_allocations = allocate_weekly_overtime(overtime_entries.select { |entry| countable?(entry) })
      grouped_days = countable.group_by(&:work_date).sort_by { |date, _| date }

      days = grouped_days.map do |date, entries|
        categories = entries.group_by(&:time_category).map do |category, category_entries|
          regular_hours = category_entries.sum { |entry| overtime_allocations.fetch(entry.id, {})[:regular_hours].to_f }
          overtime_hours = category_entries.sum { |entry| overtime_allocations.fetch(entry.id, {})[:overtime_hours].to_f }
          effective_rate_values = category_entries.filter_map(&:effective_rate_cents_snapshot).uniq

          {
            source_category_id: category&.id&.to_s,
            key: category&.key,
            name: category&.name || "Uncategorized",
            hours: round_hours(category_entries.sum { |entry| entry.hours.to_f }),
            total_hours: round_hours(category_entries.sum { |entry| entry.hours.to_f }),
            regular_hours: round_hours(regular_hours),
            overtime_hours: round_hours(overtime_hours),
            effective_rate_cents: effective_rate_values.first,
            effective_rate_cents_values: effective_rate_values,
            entry_ids: category_entries.map(&:id)
          }
        end

        {
          work_date: date.iso8601,
          hours: round_hours(entries.sum { |entry| entry.hours.to_f }),
          total_hours: round_hours(entries.sum { |entry| entry.hours.to_f }),
          regular_hours: round_hours(entries.sum { |entry| overtime_allocations.fetch(entry.id, {})[:regular_hours].to_f }),
          overtime_hours: round_hours(entries.sum { |entry| overtime_allocations.fetch(entry.id, {})[:overtime_hours].to_f }),
          entry_ids: entries.map(&:id),
          categories: categories
        }
      end

      issues = issues_for(user_entries)

      {
        source_user_id: user.id.to_s,
        email: user.email,
        first_name: user.first_name,
        last_name: user.last_name,
        display_name: user.full_name,
        approval_group: user.approval_group,
        approval_group_keys: user.approval_group_keys,
        approval_group_labels: user.approval_group_labels,
        is_intern: user.is_intern,
        employee_type: user.is_intern? ? "Intern" : "Staff",
        days: days,
        total_hours: round_hours(days.sum { |day| day[:total_hours].to_f }),
        regular_hours: round_hours(days.sum { |day| day[:regular_hours].to_f }),
        overtime_hours: round_hours(days.sum { |day| day[:overtime_hours].to_f }),
        entries_count: countable.size,
        issues: issues,
        ready: issues.values_at(:pending_count, :pending_overtime_count, :denied_count, :denied_overtime_count, :open_clock_count).all?(&:zero?)
      }
    end

    def issues_for(entries)
      pending = entries.select { |entry| entry.approval_status == "pending" }
      denied = entries.select { |entry| entry.approval_status == "denied" }
      pending_overtime = entries.select { |entry| entry.overtime_status == "pending" }
      denied_overtime = entries.select { |entry| entry.overtime_status == "denied" }
      open_clock = entries.select { |entry| entry.status.in?(%w[clocked_in on_break]) }

      {
        pending_count: pending.size,
        pending_hours: sum_hours(pending),
        pending_overtime_count: pending_overtime.size,
        pending_overtime_hours: sum_hours(pending_overtime),
        denied_count: denied.size,
        denied_hours: sum_hours(denied),
        denied_overtime_count: denied_overtime.size,
        denied_overtime_hours: sum_hours(denied_overtime),
        open_clock_count: open_clock.size,
        open_clock_entry_ids: open_clock.map(&:id)
      }
    end

    def summary(entries, employees)
      countable = entries.select { |entry| countable?(entry) }
      {
        employee_count: entries.map(&:user_id).uniq.size,
        countable_hours: sum_hours(countable),
        regular_hours: round_hours(employees.sum { |employee| employee[:regular_hours].to_f }),
        overtime_hours: round_hours(employees.sum { |employee| employee[:overtime_hours].to_f }),
        pending_count: entries.count { |entry| entry.approval_status == "pending" },
        denied_count: entries.count { |entry| entry.approval_status == "denied" },
        pending_overtime_count: entries.count { |entry| entry.overtime_status == "pending" },
        denied_overtime_count: entries.count { |entry| entry.overtime_status == "denied" },
        open_clock_count: entries.count { |entry| entry.status.in?(%w[clocked_in on_break]) }
      }
    end

    def allocate_weekly_overtime(entries)
      allocations = {}
      entries.group_by { |entry| entry.work_date.beginning_of_week(:sunday) }.each_value do |week_entries|
        cumulative = 0.0
        week_entries.sort_by { |entry| [ entry.work_date, entry_sort_seconds(entry), entry.created_at, entry.id ] }.each do |entry|
          hours = entry.hours.to_f
          regular = [ [ 40.0 - cumulative, 0.0 ].max, hours ].min
          overtime = [ hours - regular, 0.0 ].max
          allocations[entry.id] = {
            regular_hours: round_hours(regular),
            overtime_hours: round_hours(overtime)
          }
          cumulative += hours
        end
      end
      allocations
    end

    def entry_sort_seconds(entry)
      entry.start_time&.in_time_zone(TimeClockService::BUSINESS_TIMEZONE)&.seconds_since_midnight || 0
    end

    def countable?(entry)
      entry.status == "completed" && !entry.approval_status.in?(%w[denied pending])
    end

    def sum_hours(entries)
      round_hours(entries.sum { |entry| entry.hours.to_f })
    end

    def round_hours(value)
      BigDecimal(value.to_s).round(2).to_f
    end
  end
end
