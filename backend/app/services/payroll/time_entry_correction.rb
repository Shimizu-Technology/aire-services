# frozen_string_literal: true

module Payroll
  class TimeEntryCorrection
    CORRECTABLE_FIELDS = %i[work_date start_time end_time time_category_id description breaks].freeze

    class CorrectionError < StandardError; end

    def initialize(entry:, attributes:, actor:, reason:)
      @entry = entry
      @attributes = attributes.to_h.symbolize_keys.slice(*CORRECTABLE_FIELDS)
      @attributes = @attributes.reject { |key, value| !%i[breaks description].include?(key) && value.blank? }
      @actor = actor
      @reason = reason.to_s.strip
    end

    def call
      raise CorrectionError, "Submit at least one corrected time field" if attributes.empty?
      raise CorrectionError, "A correction reason is required" if reason.blank?

      entry.class.transaction do
        before = audit_snapshot(entry)
        corrected, break_rows = normalized_attributes
        entry.assign_attributes(corrected)
        if corrected[:end_time].present? && entry.active?
          entry.status = "completed"
          entry.clock_out_at = corrected.fetch(:end_time)
        end
        entry.approval_status = "pending"
        entry.approved_by = nil
        entry.approved_at = nil
        entry.approval_note = [ entry.approval_note.presence, "Corrected from Cornerstone: #{reason}" ].compact.join(" | ")
        entry.break_minutes = break_rows.sum { |row| row.fetch(:duration_minutes) } if break_rows
        entry.calculate_hours_from_times if entry.start_time.present? && entry.end_time.present?
        entry.overtime_status = if entry.status == "completed"
          TimeClockService.check_overtime_status(entry.user, entry)
        else
          "none"
        end
        entry.overtime_approved_by = nil
        entry.overtime_approved_at = nil
        entry.overtime_note = nil
        entry.save!
        replace_breaks!(break_rows) if break_rows

        after = audit_snapshot(entry)
        AuditLog.record!(
          action: "payroll_cockpit.time_entry_corrected",
          actor: actor,
          source: "integration",
          event_category: "payroll",
          auditable: entry,
          metadata: {
            reason: reason,
            before: before,
            after: after,
            requires_approval: true
          }
        )
        PayrollSettlementCase.active.where(source_time_entry_id: entry.id).find_each do |settlement_case|
          settlement_case.payroll_settlement_case_events.create!(
            event_id: SecureRandom.uuid,
            actor: actor,
            actor_payroll_integration_uuid: actor.payroll_integration_uuid,
            event_type: "corrected",
            from_status: settlement_case.status,
            to_status: settlement_case.status,
            occurred_at: Time.current,
            metadata: { reason: reason, time_entry_version: entry.lock_version }
          )
        end
        entry
      end
    rescue ActiveRecord::RecordInvalid, ActiveRecord::RecordNotDestroyed => e
      raise CorrectionError, e.record.errors.full_messages.to_sentence
    end

    private

    attr_reader :entry, :attributes, :actor, :reason

    def normalized_attributes
      corrected = attributes.dup
      raw_breaks = corrected.delete(:breaks)
      corrected[:work_date] = parse_date(corrected[:work_date]) if corrected.key?(:work_date)
      work_date = corrected[:work_date] || entry.work_date
      if corrected.key?(:start_time)
        corrected[:start_time] = parse_time(corrected[:start_time], work_date)
      elsif corrected.key?(:work_date)
        corrected[:start_time] = relocate_time(entry.start_time, work_date)
      end
      if corrected.key?(:end_time)
        corrected[:end_time] = parse_time(corrected[:end_time], work_date, after: corrected[:start_time] || relocate_time(entry.start_time, work_date))
      elsif corrected.key?(:work_date)
        corrected[:end_time] = relocate_time(entry.end_time, work_date, after: corrected[:start_time])
      end
      # Explicit partial corrections align completed punches without requiring a
      # date resend. A live session still keeps its chronology until completed.
      align_clock = corrected.key?(:work_date) || attributes.key?(:start_time) || attributes.key?(:end_time)
      if align_clock && entry.clock_entry? && (!entry.active? || corrected[:end_time].present?)
        if entry.clock_in_at
          corrected[:clock_in_at] = if attributes.key?(:start_time) || (entry.active? && corrected.key?(:work_date))
            corrected[:start_time]
          elsif corrected.key?(:work_date)
            relocate_time(entry.clock_in_at, work_date)
          else
            entry.clock_in_at
          end
        end
        if entry.clock_out_at
          corrected[:clock_out_at] = if attributes.key?(:end_time)
            corrected[:end_time]
          elsif corrected.key?(:work_date)
            relocate_time(entry.clock_out_at, work_date, after: corrected[:clock_in_at] || corrected[:start_time])
          else
            entry.clock_out_at
          end
        end
      end
      retained_breaks = false
      # A live session keeps its actual punch and break chronology. Only its
      # nominal payroll date changes until an explicit clock-out is supplied.
      if corrected.key?(:work_date) && raw_breaks.nil? && entry.time_entry_breaks.any? && !(entry.active? && corrected[:end_time].nil?)
        retained_breaks = true
        raw_breaks = entry.time_entry_breaks.order(:start_time, :id).map do |entry_break|
          { start_time: entry_break.start_time, end_time: entry_break.end_time }
        end
      end
      if corrected.key?(:time_category_id)
        category = entry.user.assigned_time_categories.active.find_by(id: corrected[:time_category_id])
        raise CorrectionError, "Choose an active work category assigned to this person" unless category
        corrected[:time_category_id] = category.id
      end
      # PostgreSQL TIME values reload on 2000-01-01. Compare parsed breaks and
      # overnight endpoints on the nominal shift date, without rewriting omitted fields.
      start_time = corrected[:start_time] || relocate_time(entry.start_time, work_date)
      end_time = corrected[:end_time] || relocate_time(entry.end_time, work_date, after: start_time)
      if entry.clock_entry? && !entry.active? && attributes.key?(:start_time) && !attributes.key?(:end_time) &&
          !attributes.key?(:work_date) && entry.start_time && entry.end_time
        # Preserve the original nominal end's Guam day offset, independently of
        # a later actual clock-out. A sparse start edit must not wrap that end.
        retained_start = relocate_time(entry.start_time, work_date)
        retained_end = relocate_time(entry.end_time, work_date)
        retained_end += 1.day if retained_end < retained_start
        nominal_span = retained_end.to_r - corrected.fetch(:start_time).to_r
        unless nominal_span >= 0 && nominal_span < 1.day.to_i
          raise CorrectionError, "Corrected start conflicts with the retained end time. Review the work date or correct the end time"
        end
      end
      if raw_breaks.nil? && !corrected.key?(:work_date) &&
          (attributes.key?(:start_time) || attributes.key?(:end_time)) &&
          entry.time_entry_breaks.any? && !(entry.active? && corrected[:end_time].nil?)
        # Omission preserves the rows, but must not let an edited shift exclude
        # an existing break. Validate retained chronology without replacing it.
        existing_breaks = entry.time_entry_breaks.order(:start_time, :id).map do |entry_break|
          { start_time: entry_break.start_time, end_time: entry_break.end_time }
        end
        normalize_breaks(existing_breaks, work_date: work_date, start_time: start_time, end_time: end_time, retained: true)
      end
      break_rows = normalize_breaks(raw_breaks, work_date: work_date, start_time: start_time, end_time: end_time, retained: retained_breaks) if raw_breaks
      [ corrected, break_rows ]
    end

    def parse_date(value)
      Date.iso8601(value.to_s)
    rescue Date::Error
      raise CorrectionError, "work_date must use YYYY-MM-DD"
    end

    def parse_time(value, work_date, after: nil)
      local = if value.to_s.match?(/\A\d{1,2}:\d{2}\z/)
        hour, minute = value.to_s.split(":").map(&:to_i)
        raise CorrectionError, "Corrected times must use HH:MM or ISO 8601" unless hour.between?(0, 23) && minute.between?(0, 59)
        [ hour, minute, 0 ]
      else
        parsed = Time.iso8601(value.to_s).in_time_zone(TimeClockService::BUSINESS_TIMEZONE)
        [ parsed.hour, parsed.min, parsed.sec + parsed.subsec ]
      end
      zone = ActiveSupport::TimeZone[TimeClockService::BUSINESS_TIMEZONE]
      result = zone.local(work_date.year, work_date.month, work_date.day, *local)
      result += 1.day if after && result <= after
      result
    rescue ArgumentError
      raise CorrectionError, "Corrected times must use HH:MM or ISO 8601"
    end

    def relocate_time(value, work_date, after: nil)
      return unless value

      local = value.in_time_zone(TimeClockService::BUSINESS_TIMEZONE)
      zone = ActiveSupport::TimeZone[TimeClockService::BUSINESS_TIMEZONE]
      result = zone.local(work_date.year, work_date.month, work_date.day, local.hour, local.min, local.sec + local.subsec)
      result += 1.day if after && result <= after
      result
    end

    def normalize_breaks(values, work_date:, start_time:, end_time:, retained: false)
      raise CorrectionError, "Complete the missing clock-out before correcting breaks" unless start_time && end_time

      rows = Array(values).map do |value|
        value = value.to_h.symbolize_keys
        raise CorrectionError, "Each break needs a start and end time" if value[:start_time].blank? || value[:end_time].blank?

        break_start = retained ? relocate_time(value[:start_time], work_date) : parse_time(value[:start_time], work_date)
        break_start += 1.day if break_start < start_time
        break_end = if retained
          relocate_time(value[:end_time], work_date, after: break_start)
        else
          parse_time(value[:end_time], work_date, after: break_start)
        end
        if break_start < start_time || break_end > end_time
          raise CorrectionError, "Breaks must fall within the corrected shift"
        end
        {
          start_time: break_start,
          end_time: break_end,
          duration_minutes: ((break_end - break_start) / 60).round
        }
      end.sort_by { |row| row.fetch(:start_time) }
      if rows.each_cons(2).any? { |left, right| left.fetch(:end_time) > right.fetch(:start_time) }
        raise CorrectionError, "Breaks cannot overlap"
      end
      rows
    end

    def replace_breaks!(rows)
      entry.time_entry_breaks.each(&:destroy!)
      rows.each { |attributes| entry.time_entry_breaks.create!(attributes) }
    end

    def audit_snapshot(record)
      {
        work_date: record.work_date.iso8601,
        start_time: record.start_time&.iso8601(6),
        end_time: record.end_time&.iso8601(6),
        clock_in_at: record.clock_in_at&.iso8601(6),
        clock_out_at: record.clock_out_at&.iso8601(6),
        hours: record.hours.to_f,
        break_minutes: record.break_minutes.to_i,
        time_category_id: record.time_category_id,
        approval_status: record.approval_status,
        overtime_status: record.overtime_status,
        status: record.status,
        breaks: record.time_entry_breaks.order(:start_time, :id).map do |entry_break|
          {
            start_time: entry_break.start_time.iso8601(6),
            end_time: entry_break.end_time&.iso8601(6),
            duration_minutes: entry_break.duration_minutes
          }
        end
      }
    end
  end
end
