# frozen_string_literal: true

require "set"

module Payroll
  class HoursReportBuilder
    BUSINESS_TIMEZONE = TimeClockService::BUSINESS_TIMEZONE
    WEEKLY_OVERTIME_THRESHOLD = 40.0
    MAX_RANGE_DAYS = 62

    attr_reader :params, :start_date, :end_date, :context_start_date, :context_end_date

    def initialize(params = {})
      @params = params
      @start_date = parse_date!(params[:start_date], "start_date")
      @end_date = parse_date!(params[:end_date], "end_date")
      raise ArgumentError, "end_date must be on or after start_date" if @end_date < @start_date
      raise ArgumentError, "date range may not exceed #{MAX_RANGE_DAYS} days" if (@end_date - @start_date).to_i > MAX_RANGE_DAYS

      @context_start_date = @start_date.beginning_of_week(:sunday)
      @context_end_date = @end_date.end_of_week(:sunday)
    end

    def call
      scoped_users = users_scope.to_a
      user_ids = scoped_users.map(&:id)
      overtime_context_entries = overtime_context_entries_scope(context_start_date..context_end_date, user_ids).to_a
      report_entries = report_entries_scope(context_start_date..context_end_date, user_ids).to_a
      period_entries = report_entries.select { |entry| entry.work_date.between?(start_date, end_date) }
      employees = build_employee_reports(scoped_users, overtime_context_entries, report_entries)

      {
        start_date: start_date.iso8601,
        end_date: end_date.iso8601,
        context_start_date: context_start_date.iso8601,
        context_end_date: context_end_date.iso8601,
        generated_at: Time.current.iso8601,
        filters: serialized_filters,
        summary: summary(employees, period_entries),
        employees: employees
      }
    end

    private

    def parse_date!(value, name)
      raise ArgumentError, "#{name} is required" if value.blank?

      Date.iso8601(value.to_s)
    rescue Date::Error
      raise ArgumentError, "#{name} must be a valid ISO 8601 date (YYYY-MM-DD)"
    end

    def users_scope
      scope = User.staff.includes(:assigned_time_categories).order(:last_name, :first_name, :email, :id)
      scope = scope.where(id: params[:user_id]) if params[:user_id].present?
      scope = scope.where(role: params[:role]) if params[:role].present? && %w[admin employee].include?(params[:role].to_s)

      case params[:status].to_s
      when "active"
        scope = scope.where(is_active: true).where.not("clerk_id LIKE 'pending_%'")
      when "current"
        scope = scope.where(is_active: true)
      when "pending"
        scope = scope.where(is_active: true).where("clerk_id LIKE 'pending_%'")
      when "inactive"
        scope = scope.where(is_active: false)
      end

      case params[:approval_group].to_s
      when "", "all"
        scope
      when "unassigned"
        scope.where(approval_group: nil)
      else
        scope.where(approval_group: params[:approval_group])
      end
    end

    def overtime_context_entries_scope(range, user_ids)
      base_entries_scope(range, user_ids)
    end

    def report_entries_scope(range, user_ids)
      scope = base_entries_scope(range, user_ids)
      scope = scope.where(time_category_id: params[:time_category_id]) if params[:time_category_id].present?
      scope = scope.where(clock_source: params[:clock_source]) if params[:clock_source].present?
      scope = scope.where(entry_method: params[:entry_method]) if params[:entry_method].present?
      scope = scope.where(approval_status: approval_status_value(params[:approval_status])) if params[:approval_status].present?
      scope = scope.where(overtime_status: params[:overtime_status]) if params[:overtime_status].present?
      scope
    end

    def base_entries_scope(range, user_ids)
      return TimeEntry.none if user_ids.empty?

      TimeEntry
        .where(user_id: user_ids, work_date: range)
        .includes(:user, :time_category, :time_entry_breaks)
        .order(:work_date, :start_time, :created_at, :id)
    end

    def approval_status_value(value)
      value.to_s == "approved_or_standard" ? [ "approved", nil ] : value
    end

    def build_employee_reports(users, overtime_context_entries, report_entries)
      context_entries_by_user = overtime_context_entries.group_by(&:user_id)
      report_entries_by_user = report_entries.group_by(&:user_id)

      users.filter_map do |user|
        user_context_entries = context_entries_by_user.fetch(user.id, [])
        user_report_entries = report_entries_by_user.fetch(user.id, [])
        period_entries = user_report_entries.select { |entry| entry.work_date.between?(start_date, end_date) }
        next if period_entries.empty? && !include_empty_employees?

        build_employee_report(user, user_context_entries, user_report_entries)
      end
    end

    def include_empty_employees?
      ActiveModel::Type::Boolean.new.cast(params[:include_empty])
    end

    def build_employee_report(user, user_context_entries, user_report_entries)
      overtime_allocations = allocate_weekly_overtime(user_context_entries)
      period_entries = user_report_entries.select { |entry| entry.work_date.between?(start_date, end_date) }
      countable_period_entries = period_entries.select { |entry| countable?(entry) }
      days = build_days(countable_period_entries, overtime_allocations)
      categories = build_categories(countable_period_entries, overtime_allocations)
      weeks = build_weeks(user_context_entries, countable_period_entries, overtime_allocations)
      issues = issues_for(period_entries)

      regular_hours = sum(days, :regular_hours)
      overtime_hours = sum(days, :overtime_hours)
      total_hours = sum(days, :total_hours)
      break_hours = round_hours(countable_period_entries.sum { |entry| entry.break_minutes.to_i / 60.0 })

      {
        id: user.id,
        email: user.email,
        first_name: user.first_name,
        last_name: user.last_name,
        display_name: user.display_name,
        full_name: user.full_name,
        role: user.role,
        status: user_status(user),
        approval_group: user.approval_group,
        approval_group_label: user.approval_group_label,
        total_hours: total_hours,
        regular_hours: regular_hours,
        overtime_hours: overtime_hours,
        break_hours: break_hours,
        entries_count: countable_period_entries.size,
        ready: report_ready?(issues),
        issues: issues,
        days: days,
        categories: categories,
        weeks: weeks
      }
    end

    def allocate_weekly_overtime(entries)
      allocations = {}
      countable_entries = entries.select { |entry| countable?(entry) }
      countable_entries.group_by { |entry| entry.work_date.beginning_of_week(:sunday) }.each_value do |week_entries|
        cumulative = 0.0
        week_entries.sort_by { |entry| [ entry.work_date, entry_sort_seconds(entry), entry.created_at, entry.id ] }.each do |entry|
          hours = entry.hours.to_f
          regular = [ [ WEEKLY_OVERTIME_THRESHOLD - cumulative, 0 ].max, hours ].min
          overtime = hours - regular
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

    def build_days(entries, allocations)
      entries.group_by(&:work_date).sort_by { |date, _| date }.map do |date, day_entries|
        regular = day_entries.sum { |entry| allocations.fetch(entry.id, {})[:regular_hours].to_f }
        overtime = day_entries.sum { |entry| allocations.fetch(entry.id, {})[:overtime_hours].to_f }
        {
          work_date: date.iso8601,
          total_hours: round_hours(day_entries.sum { |entry| entry.hours.to_f }),
          regular_hours: round_hours(regular),
          overtime_hours: round_hours(overtime),
          break_hours: round_hours(day_entries.sum { |entry| entry.break_minutes.to_i / 60.0 }),
          entries: day_entries.map { |entry| serialize_entry(entry, allocations.fetch(entry.id, {})) }
        }
      end
    end

    def build_categories(entries, allocations)
      entries.group_by(&:time_category).map do |category, category_entries|
        {
          id: category&.id,
          key: category&.key,
          name: category&.name || "Uncategorized",
          total_hours: round_hours(category_entries.sum { |entry| entry.hours.to_f }),
          regular_hours: round_hours(category_entries.sum { |entry| allocations.fetch(entry.id, {})[:regular_hours].to_f }),
          overtime_hours: round_hours(category_entries.sum { |entry| allocations.fetch(entry.id, {})[:overtime_hours].to_f }),
          break_hours: round_hours(category_entries.sum { |entry| entry.break_minutes.to_i / 60.0 }),
          entries_count: category_entries.size
        }
      end.sort_by { |row| [ row[:name], row[:id].to_i ] }
    end

    def build_weeks(context_entries, period_report_entries, allocations)
      report_entry_ids = period_report_entries.map(&:id).to_set

      context_entries.group_by { |entry| entry.work_date.beginning_of_week(:sunday) }.sort_by { |date, _| date }.map do |week_start, week_entries|
        week_end = week_start.end_of_week(:sunday)
        countable = week_entries.select { |entry| countable?(entry) }
        period_entries = countable.select { |entry| report_entry_ids.include?(entry.id) }
        context_entries_for_week = countable.reject { |entry| report_entry_ids.include?(entry.id) }
        next if period_entries.empty?

        context_hours = round_hours(context_entries_for_week.sum { |entry| entry.hours.to_f })
        {
          week_start: week_start.iso8601,
          week_end: week_end.iso8601,
          weekly_total_hours: round_hours(countable.sum { |entry| entry.hours.to_f }),
          period_hours: round_hours(period_entries.sum { |entry| entry.hours.to_f }),
          context_hours: context_hours,
          regular_hours: round_hours(period_entries.sum { |entry| allocations.fetch(entry.id, {})[:regular_hours].to_f }),
          overtime_hours: round_hours(period_entries.sum { |entry| allocations.fetch(entry.id, {})[:overtime_hours].to_f }),
          context_note: context_hours.positive? ? "Includes #{context_hours}h from outside this filtered report selection to calculate Sunday–Saturday overtime." : nil
        }
      end.compact
    end

    def serialize_entry(entry, allocation)
      {
        id: entry.id,
        work_date: entry.work_date.iso8601,
        start_time: entry.start_time&.in_time_zone(BUSINESS_TIMEZONE)&.strftime("%H:%M"),
        end_time: entry.end_time&.in_time_zone(BUSINESS_TIMEZONE)&.strftime("%H:%M"),
        formatted_start_time: entry.formatted_start_time,
        formatted_end_time: entry.formatted_end_time,
        total_hours: round_hours(entry.hours.to_f),
        regular_hours: allocation[:regular_hours].to_f,
        overtime_hours: allocation[:overtime_hours].to_f,
        break_minutes: entry.break_minutes.to_i,
        description: entry.description,
        entry_method: entry.entry_method,
        clock_source: entry.clock_source,
        approval_status: entry.approval_status,
        overtime_status: entry.overtime_status,
        locked_at: entry.locked_at&.iso8601,
        time_category: entry.time_category ? {
          id: entry.time_category.id,
          key: entry.time_category.key,
          name: entry.time_category.name
        } : nil,
        breaks: entry.time_entry_breaks.sort_by(&:start_time).map do |entry_break|
          {
            id: entry_break.id,
            start_time: entry_break.start_time&.in_time_zone(BUSINESS_TIMEZONE)&.strftime("%H:%M"),
            end_time: entry_break.end_time&.in_time_zone(BUSINESS_TIMEZONE)&.strftime("%H:%M"),
            duration_minutes: entry_break.duration_minutes
          }
        end
      }
    end

    def issues_for(entries)
      {
        pending_count: entries.count { |entry| entry.approval_status == "pending" },
        denied_count: entries.count { |entry| entry.approval_status == "denied" },
        pending_overtime_count: entries.count { |entry| entry.overtime_status == "pending" },
        denied_overtime_count: entries.count { |entry| entry.overtime_status == "denied" },
        open_clock_count: entries.count { |entry| entry.status.in?(%w[clocked_in on_break]) }
      }
    end

    def report_ready?(issues)
      issues.values.all?(&:zero?)
    end

    def summary(employees, period_entries)
      {
        employee_count: employees.size,
        total_hours: sum(employees, :total_hours),
        regular_hours: sum(employees, :regular_hours),
        overtime_hours: sum(employees, :overtime_hours),
        break_hours: sum(employees, :break_hours),
        entries_count: employees.sum { |employee| employee[:entries_count].to_i },
        pending_count: period_entries.count { |entry| entry.approval_status == "pending" },
        denied_count: period_entries.count { |entry| entry.approval_status == "denied" },
        pending_overtime_count: period_entries.count { |entry| entry.overtime_status == "pending" },
        denied_overtime_count: period_entries.count { |entry| entry.overtime_status == "denied" },
        open_clock_count: period_entries.count { |entry| entry.status.in?(%w[clocked_in on_break]) }
      }
    end

    def entry_sort_seconds(entry)
      entry.start_time&.in_time_zone(BUSINESS_TIMEZONE)&.seconds_since_midnight || 0
    end

    def serialized_filters
      params.to_h.slice(:user_id, :role, :status, :approval_group, :time_category_id, :clock_source, :entry_method, :approval_status, :overtime_status, :include_empty)
    end

    def countable?(entry)
      entry.status == "completed" && !entry.approval_status.in?(%w[denied pending])
    end

    def user_status(user)
      return "inactive" unless user.is_active?
      return "pending" if user.pending_invite?

      "active"
    end

    def sum(rows, key)
      round_hours(rows.sum { |row| row[key].to_f })
    end

    def round_hours(value)
      BigDecimal(value.to_s).round(2).to_f
    end
  end
end
