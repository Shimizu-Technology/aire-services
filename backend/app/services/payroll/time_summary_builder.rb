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
      users = User.staff.where(id: entries.map(&:user_id).uniq).order(:last_name, :first_name, :email).to_a
      entries_by_user_id = entries.group_by(&:user_id)

      {
        source: SOURCE,
        start_date: start_date.iso8601,
        end_date: end_date.iso8601,
        generated_at: Time.current.iso8601,
        employees: users.map { |user| serialize_user(user, entries_by_user_id.fetch(user.id, [])) },
        summary: summary(entries)
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

    def serialize_user(user, user_entries)
      countable = user_entries.select { |entry| countable?(entry) }
      grouped_days = countable.group_by(&:work_date).sort_by { |date, _| date }

      days = grouped_days.map do |date, entries|
        categories = entries.group_by(&:time_category).map do |category, category_entries|
          {
            source_category_id: category&.id&.to_s,
            key: category&.key,
            name: category&.name || "Uncategorized",
            hours: round_hours(category_entries.sum { |entry| entry.hours.to_f }),
            effective_rate_cents: category_entries.filter_map(&:effective_rate_cents_snapshot).first,
            entry_ids: category_entries.map(&:id)
          }
        end

        {
          work_date: date.iso8601,
          hours: round_hours(entries.sum { |entry| entry.hours.to_f }),
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
        days: days,
        total_hours: round_hours(days.sum { |day| day[:hours].to_f }),
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

    def summary(entries)
      countable = entries.select { |entry| countable?(entry) }
      {
        employee_count: entries.map(&:user_id).uniq.size,
        countable_hours: sum_hours(countable),
        pending_count: entries.count { |entry| entry.approval_status == "pending" },
        denied_count: entries.count { |entry| entry.approval_status == "denied" },
        pending_overtime_count: entries.count { |entry| entry.overtime_status == "pending" },
        denied_overtime_count: entries.count { |entry| entry.overtime_status == "denied" },
        open_clock_count: entries.count { |entry| entry.status.in?(%w[clocked_in on_break]) }
      }
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
