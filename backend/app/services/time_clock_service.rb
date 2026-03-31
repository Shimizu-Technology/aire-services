# frozen_string_literal: true

class TimeClockService
  BUSINESS_TIMEZONE = "Guam"

  class ClockError < StandardError; end
  class AuthorizationError < StandardError; end

  class << self
    # ── Clock In ──
    def clock_in(user:, admin_override_by: nil, time_category_id: nil)
      now = Time.current
      guam_now = now.in_time_zone(business_timezone)
      today = guam_now.to_date

      raise ClockError, "You are already clocked in" if active_entry_for(user)

      schedule = Schedule.for_user(user.id).for_date(today).order(created_at: :desc).first

      unless schedule || admin_override_by
        raise ClockError, "No shift scheduled for today. Contact your manager if you need to work today."
      end

      if schedule && !admin_override_by
        validate_clock_in_time(now, schedule)
      end

      selected_time_category = nil
      if time_category_id.present?
        selected_time_category = TimeCategory.active.find_by(id: time_category_id)
        raise ClockError, "Selected work category is invalid or inactive" unless selected_time_category
      end

      entry = TimeEntry.new(
        user: user,
        work_date: today,
        start_time: guam_now,
        clock_in_at: now,
        entry_method: "clock",
        status: "clocked_in",
        hours: 0,
        schedule: schedule,
        time_category: selected_time_category,
        admin_override: admin_override_by.present?,
        approval_status: nil,
        attendance_status: schedule ? calculate_attendance_status(now, schedule) : nil
      )

      entry.save!
      entry
    rescue ActiveRecord::RecordNotUnique
      raise ClockError, "You are already clocked in"
    end

    # ── Clock Out ──
    def clock_out(user:, admin_override_by: nil, corrected_end_time: nil, description: nil)
      entry = active_entry_for(user)
      raise ClockError, "Not currently clocked in" unless entry

      ActiveRecord::Base.transaction do
        if entry.status == "on_break"
          active_break = entry.active_break
          active_break&.close!
        end

        now = Time.current
        guam_now = now.in_time_zone(business_timezone)

        if corrected_end_time.present?
          begin
            parsed = ActiveSupport::TimeZone[business_timezone].parse(corrected_end_time)
          rescue ArgumentError
            raise ClockError, "Invalid corrected time format"
          end
          if parsed <= entry.start_time.in_time_zone(business_timezone)
            raise ClockError, "Corrected time (#{parsed.strftime('%I:%M %p')}) must be after your clock-in time (#{entry.start_time.in_time_zone(business_timezone).strftime('%I:%M %p')})"
          end
          if parsed > guam_now
            raise ClockError, "Corrected time (#{parsed.strftime('%I:%M %p')}) cannot be in the future"
          end
          entry.end_time = parsed
          entry.clock_out_at = now
          entry.approval_status = "pending"
          entry.approval_note = "Employee corrected clock-out time to #{parsed.strftime('%I:%M %p')}"
        else
          entry.end_time = guam_now
          entry.clock_out_at = now
        end

        entry.description = description if description.present?
        entry.status = "completed"
        entry.break_minutes = entry.total_break_minutes
        entry.calculate_hours_from_times
        entry.overtime_status = check_overtime_status(user, entry)
        entry.admin_override = true if admin_override_by.present?

        entry.save!
      end

      entry
    end

    # ── Start Break ──
    def start_break(user:, admin_override_by: nil)
      entry = active_entry_for(user)
      raise ClockError, "You are not currently clocked in" unless entry
      raise ClockError, "You are already on a break" if entry.status == "on_break"

      ActiveRecord::Base.transaction do
        now = Time.current
        entry.time_entry_breaks.create!(start_time: now)
        entry.admin_override = true if admin_override_by.present?
        entry.update!(status: "on_break")
      end

      entry
    rescue ActiveRecord::RecordNotUnique
      raise ClockError, "You are already on a break"
    end

    # ── End Break ──
    def end_break(user:, admin_override_by: nil)
      entry = active_entry_for(user)
      raise ClockError, "You are not currently clocked in" unless entry
      raise ClockError, "You are not currently on a break" unless entry.status == "on_break"

      active_break = entry.active_break
      raise ClockError, "No active break found" unless active_break

      ActiveRecord::Base.transaction do
        active_break.close!
        entry.admin_override = true if admin_override_by.present?
        entry.update!(status: "clocked_in")
      end

      entry
    end

    # ── Current Status ──
    def current_status(user:)
      entry = active_entry_for(user)
      today = Time.current.in_time_zone(business_timezone).to_date
      schedule = Schedule.for_user(user.id).for_date(today).order(created_at: :desc).first

      clock_in_info = can_clock_in_info(user, schedule, existing_entry: entry)

      {
        clocked_in: entry.present?,
        status: entry&.status,
        entry_id: entry&.id,
        clock_in_at: entry&.clock_in_at,
        elapsed_minutes: entry ? ((Time.current - entry.clock_in_at) / 60).round : nil,
        break_minutes: entry&.total_break_minutes || 0,
        active_break: entry&.active_break.present?,
        active_break_started_at: entry&.active_break&.start_time,
        breaks: entry ? entry.time_entry_breaks.order(:start_time).map { |b|
          { start_time: b.start_time, end_time: b.end_time, duration_minutes: b.duration_minutes, active: b.active? }
        } : [],
        schedule: schedule ? {
          id: schedule.id,
          start_time: schedule.formatted_start_time,
          end_time: schedule.formatted_end_time,
          hours: schedule.hours
        } : nil,
        can_clock_in: clock_in_info[:allowed],
        clock_in_blocked_reason: clock_in_info[:reason],
        minutes_until: clock_in_info[:minutes_until]
      }
    end

    # ── Admin: Approve Entry ──
    def approve_entry(entry:, approved_by:, note: nil)
      raise AuthorizationError, "Only admins can approve entries" unless approved_by.admin?

      entry.with_lock do
        raise ClockError, "Entry is not pending approval" unless entry.pending_approval?

        attrs = {
          approval_status: "approved",
          approved_by: approved_by,
          approved_at: Time.current,
          approval_note: note
        }

        if entry.status == "completed" && entry.overtime_status.in?([nil, "none"])
          attrs[:overtime_status] = check_overtime_status(entry.user, entry)
        end

        entry.update!(attrs)
      end
      entry
    end

    # ── Admin: Deny Entry ──
    # Note: approved_by/approved_at store the acting admin for both approvals
    # and denials. The approval_status field distinguishes the action taken.
    def deny_entry(entry:, denied_by:, note: nil)
      raise AuthorizationError, "Only admins can deny entries" unless denied_by.admin?

      entry.with_lock do
        raise ClockError, "Entry is not pending approval" unless entry.pending_approval?

        entry.update!(
          approval_status: "denied",
          approved_by: denied_by,
          approved_at: Time.current,
          approval_note: note
        )
      end
      entry
    end

    # ── Admin: Approve Overtime ──
    def approve_overtime(entry:, approved_by:, note: nil)
      raise AuthorizationError, "Only admins can approve overtime" unless approved_by.admin?

      entry.with_lock do
        raise ClockError, "Entry does not have pending overtime" unless entry.overtime_status == "pending"

        entry.update!(
          overtime_status: "approved",
          overtime_approved_by: approved_by,
          overtime_approved_at: Time.current,
          overtime_note: note
        )
      end
      entry
    end

    # ── Admin: Deny Overtime ──
    def deny_overtime(entry:, denied_by:, note: nil)
      raise AuthorizationError, "Only admins can deny overtime" unless denied_by.admin?

      entry.with_lock do
        raise ClockError, "Entry does not have pending overtime" unless entry.overtime_status == "pending"

        entry.update!(
          overtime_status: "denied",
          overtime_approved_by: denied_by,
          overtime_approved_at: Time.current,
          overtime_note: note
        )
      end
      entry
    end

    # ── Helpers ──

    def active_entry_for(user)
      TimeEntry.clocked_in.for_user(user).order(created_at: :desc).first
    end

    def flag_stale_entries(threshold_hours: 12)
      cutoff = threshold_hours.hours.ago
      stale = TimeEntry.clocked_in.where("clock_in_at < ?", cutoff)
      count = stale.count

      stale.find_each do |entry|
        begin
          ActiveRecord::Base.transaction do
            if entry.status == "on_break"
              entry.active_break&.close!
            end

            guam_now = Time.current.in_time_zone(business_timezone)
            entry.end_time = guam_now
            entry.clock_out_at = Time.current
            entry.calculate_hours_from_times
            entry.update!(
              end_time: entry.end_time,
              clock_out_at: entry.clock_out_at,
              hours: entry.hours,
              status: "completed",
              break_minutes: entry.total_break_minutes,
              admin_override: true,
              approval_status: "pending",
              approval_note: "Auto-closed: clocked in for over #{threshold_hours} hours without clocking out"
            )

            AuditLog.create!(
              auditable: entry,
              action: "updated",
              user: nil,
              metadata: "System auto-closed stale time entry (>#{threshold_hours}h) for #{entry.user&.full_name}"
            )
          end
        rescue StandardError => e
          Rails.logger.error("Failed to auto-close stale entry #{entry.id}: #{e.message}")
        end
      end

      count
    end

    def hours_today(user, date = Date.current)
      TimeEntry.countable.for_user(user).for_date(date).sum(:hours).to_f
    end

    def hours_this_week(user, date = Date.current)
      TimeEntry.countable.for_user(user).for_week(date).sum(:hours).to_f
    end

    # Evaluates whether an entry triggers overtime thresholds.
    # include_entry_hours: true when entry is unsaved (clock_out flow),
    # false when entry is already persisted (edit flow) to avoid double-counting.
    def check_overtime_status(user, entry, include_entry_hours: true)
      daily_threshold = (Setting.get("overtime_daily_threshold_hours") || "8").to_f
      weekly_threshold = (Setting.get("overtime_weekly_threshold_hours") || "40").to_f

      daily_hours = hours_today(user, entry.work_date)
      weekly_hours = hours_this_week(user, entry.work_date)

      if include_entry_hours
        daily_hours += entry.hours
        weekly_hours += entry.hours
      end

      if daily_hours > daily_threshold || weekly_hours > weekly_threshold
        "pending"
      else
        "none"
      end
    end

    private

    # Schedule times are stored as wall-clock times in UTC (e.g., 7:30 PM stored
    # as 19:30 UTC). We need the current local wall-clock time in the same
    # representation so comparisons work correctly.
    def local_seconds_since_midnight
      local_now = Time.current.in_time_zone(business_timezone)
      local_now.seconds_since_midnight
    end

    def business_timezone
      BUSINESS_TIMEZONE
    end

    def validate_clock_in_time(now, schedule)
      buffer = (Setting.get("early_clock_in_buffer_minutes") || "5").to_i

      earliest_allowed = [schedule.start_time.utc.seconds_since_midnight - (buffer * 60), 0].max
      latest_allowed = schedule.end_time.utc.seconds_since_midnight
      current_seconds = now.in_time_zone(business_timezone).seconds_since_midnight

      if current_seconds < earliest_allowed
        formatted_start = schedule.formatted_start_time
        errors_msg = "Your shift starts at #{formatted_start}. You can clock in starting at #{buffer} minutes before."
        raise ClockError, errors_msg
      end

      if latest_allowed > earliest_allowed && current_seconds > latest_allowed
        formatted_end = schedule.formatted_end_time
        raise ClockError, "Your shift ended at #{formatted_end}. Please submit a manual entry if you need to log time."
      end
    end

    def calculate_attendance_status(now, schedule)
      current_seconds = now.in_time_zone(business_timezone).seconds_since_midnight
      scheduled_start_seconds = schedule.start_time.utc.seconds_since_midnight
      buffer_seconds = (Setting.get("early_clock_in_buffer_minutes") || "5").to_i * 60

      if current_seconds < scheduled_start_seconds
        "early"
      elsif current_seconds <= scheduled_start_seconds + buffer_seconds
        "on_time"
      else
        "late"
      end
    end

    def can_clock_in_info(user, schedule, existing_entry: nil)
      active = existing_entry.nil? ? active_entry_for(user) : existing_entry
      return { allowed: false, reason: "already_clocked_in" } if active
      return { allowed: false, reason: "no_schedule" } unless schedule

      buffer = (Setting.get("early_clock_in_buffer_minutes") || "5").to_i
      earliest_allowed = [schedule.start_time.utc.seconds_since_midnight - (buffer * 60), 0].max
      latest_allowed = schedule.end_time.utc.seconds_since_midnight
      current_seconds = local_seconds_since_midnight

      if latest_allowed > earliest_allowed && current_seconds > latest_allowed
        { allowed: false, reason: "shift_ended" }
      elsif current_seconds >= earliest_allowed
        { allowed: true, reason: nil }
      else
        minutes_until = ((earliest_allowed - current_seconds) / 60).ceil
        { allowed: false, reason: "too_early", minutes_until: minutes_until }
      end
    end
  end
end
