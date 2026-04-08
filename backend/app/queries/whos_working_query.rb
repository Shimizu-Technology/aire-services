# frozen_string_literal: true

class WhosWorkingQuery
  class << self
    def call
      today = Time.current.in_time_zone(TimeClockService::BUSINESS_TIMEZONE).to_date
      staff_users = User.staff.order(:first_name, :last_name)
      staff_ids = staff_users.pluck(:id)

      today_schedules = Schedule.where(user_id: staff_ids, work_date: today).index_by(&:user_id)

      all_today_entries = TimeEntry.where(user_id: staff_ids, work_date: today)
                                   .where(entry_method: "clock")
                                   .includes(:time_entry_breaks, :time_category)
                                   .order(clock_in_at: :asc)

      entries_by_user = all_today_entries.group_by(&:user_id)

      completed_hours = TimeEntry.countable.where(user_id: staff_ids).for_date(today)
                                 .group(:user_id).sum(:hours)

      clocked_out_user_ids = all_today_entries.select { |e| e.status == "completed" }.map(&:user_id).to_set
      active_entries_by_user = all_today_entries.select { |e| %w[clocked_in on_break].include?(e.status) }
                                                .index_by(&:user_id)

      buffer_seconds = (Setting.get("early_clock_in_buffer_minutes") || "5").to_i * 60

      staff_users.map do |user|
        schedule = today_schedules[user.id]
        active_entry = active_entries_by_user[user.id]
        user_entries = entries_by_user[user.id] || []
        hours = (completed_hours[user.id] || 0).to_f.round(2)

        active_break_record = active_entry&.active_break
        elapsed_hours = calculate_elapsed(active_entry, active_break_record)

        latest_entry = active_entry || user_entries.last
        all_breaks = user_entries.flat_map { |e| serialize_breaks(e) }.sort_by { |b| b[:start_time] }
        total_break_min = user_entries.sum(&:total_break_minutes)

        {
          user: {
            id: user.id,
            full_name: user.full_name,
            display_name: user.display_name,
            email: user.email
          },
          schedule: schedule ? {
            start_time: schedule.formatted_start_time,
            end_time: schedule.formatted_end_time,
            hours: schedule.hours
          } : nil,
          status: resolve_status(active_entry, clocked_out_user_ids, user, schedule, buffer_seconds),
          clock_in_at: user_entries.first&.clock_in_at&.iso8601,
          clock_out_at: (active_entry&.clock_out_at || user_entries.select { |e| e.status == "completed" }.last&.clock_out_at)&.iso8601,
          clock_source: latest_entry&.clock_source,
          completed_hours: (hours + elapsed_hours).round(2),
          active_break: active_break_record.present?,
          break_started_at: active_break_record&.start_time&.iso8601,
          total_break_minutes: total_break_min,
          breaks: all_breaks,
          time_category: serialize_time_category(active_entry || user_entries.last),
          day_entries: user_entries.map { |e| serialize_day_entry(e) }
        }
      end
    end

    private

    def calculate_elapsed(active_entry, active_break_record)
      return 0.0 unless active_entry&.clock_in_at

      elapsed = (Time.current - active_entry.clock_in_at) / 3600.0
      completed_break_hours = (active_entry.total_break_minutes || 0) / 60.0
      active_break_hours = if active_break_record&.start_time
        (Time.current - active_break_record.start_time) / 3600.0
      else
        0.0
      end
      (elapsed - completed_break_hours - active_break_hours).clamp(0, Float::INFINITY).round(2)
    end

    def resolve_status(active_entry, clocked_out_user_ids, user, schedule, buffer_seconds)
      if active_entry
        active_entry.status
      elsif clocked_out_user_ids.include?(user.id)
        "clocked_out"
      elsif schedule
        guam_now = Time.current.in_time_zone(TimeClockService::BUSINESS_TIMEZONE)
        shift_start_seconds = schedule.start_time.utc.seconds_since_midnight
        shift_end_seconds = schedule.end_time.utc.seconds_since_midnight
        current_seconds = guam_now.seconds_since_midnight
        if current_seconds > shift_end_seconds && shift_end_seconds > shift_start_seconds
          "no_show"
        elsif current_seconds > shift_start_seconds + buffer_seconds
          "late"
        else
          "not_clocked_in"
        end
      else
        "no_schedule"
      end
    end

    def serialize_breaks(entry)
      return [] unless entry

      breaks = if entry.time_entry_breaks.loaded?
        entry.time_entry_breaks.sort_by(&:start_time)
      else
        entry.time_entry_breaks.order(:start_time)
      end

      breaks.map do |b|
        {
          start_time: b.start_time.iso8601,
          end_time: b.end_time&.iso8601,
          duration_minutes: b.duration_minutes,
          active: b.active?
        }
      end
    end

    def serialize_time_category(entry)
      return nil unless entry&.time_category

      {
        id: entry.time_category.id,
        key: entry.time_category.key,
        name: entry.time_category.name
      }
    end

    def serialize_day_entry(entry)
      {
        id: entry.id,
        status: entry.status,
        clock_in_at: entry.clock_in_at&.iso8601,
        clock_out_at: entry.clock_out_at&.iso8601,
        hours: entry.hours.to_f.round(2),
        clock_source: entry.clock_source,
        time_category: serialize_time_category(entry),
        breaks: serialize_breaks(entry)
      }
    end
  end
end
