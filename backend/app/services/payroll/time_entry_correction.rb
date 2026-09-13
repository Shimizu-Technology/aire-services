# frozen_string_literal: true

module Payroll
  class TimeEntryCorrection
    CORRECTABLE_FIELDS = %i[work_date start_time end_time time_category_id description breaks].freeze

    class CorrectionError < StandardError; end

    def initialize(entry:, attributes:, actor:, reason:)
      @entry = entry
      @attributes = attributes.to_h.symbolize_keys.slice(*CORRECTABLE_FIELDS)
      @attributes = @attributes.reject { |key, value| key != :breaks && value.blank? }
      @actor = actor
      @reason = reason.to_s.strip
    end

    def call
      raise CorrectionError, "Submit at least one corrected time field" if attributes.empty?
      raise CorrectionError, "A correction reason is required" if reason.blank?

      before = audit_snapshot(entry)
      corrected, break_rows = normalized_attributes
      entry.assign_attributes(corrected)
      if corrected.key?(:end_time) && entry.active?
        entry.status = "completed"
        entry.clock_out_at = corrected.fetch(:end_time)
      end
      entry.approval_status = "pending"
      entry.approved_by = nil
      entry.approved_at = nil
      entry.approval_note = [ entry.approval_note.presence, "Corrected from Cornerstone: #{reason}" ].compact.join(" | ")
      entry.break_minutes = break_rows.sum { |row| row.fetch(:duration_minutes) } if break_rows
      entry.calculate_hours_from_times if entry.start_time.present? && entry.end_time.present?
      entry.overtime_status = "pending" if entry.status == "completed"
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
    rescue ActiveRecord::RecordInvalid => e
      raise CorrectionError, e.record.errors.full_messages.to_sentence
    end

    private

    attr_reader :entry, :attributes, :actor, :reason

    def normalized_attributes
      corrected = attributes.dup
      raw_breaks = corrected.delete(:breaks)
      corrected[:work_date] = parse_date(corrected[:work_date]) if corrected.key?(:work_date)
      work_date = corrected[:work_date] || entry.work_date
      if corrected.key?(:work_date)
        corrected[:start_time] = relocate_time(entry.start_time, work_date) unless corrected.key?(:start_time)
        corrected[:end_time] = relocate_time(entry.end_time, work_date, after: corrected[:start_time]) unless corrected.key?(:end_time)
        raw_breaks ||= entry.time_entry_breaks.order(:start_time, :id).map do |entry_break|
          { start_time: entry_break.start_time.iso8601, end_time: entry_break.end_time&.iso8601 }
        end
      end
      corrected[:start_time] = parse_time(corrected[:start_time], work_date) if corrected.key?(:start_time)
      if corrected.key?(:end_time)
        corrected[:end_time] = parse_time(corrected[:end_time], work_date, after: corrected[:start_time] || entry.start_time)
      end
      if corrected.key?(:time_category_id)
        category = entry.user.assigned_time_categories.active.find_by(id: corrected[:time_category_id])
        raise CorrectionError, "Choose an active work category assigned to this person" unless category
        corrected[:time_category_id] = category.id
      end
      start_time = corrected[:start_time] || entry.start_time
      end_time = corrected[:end_time] || entry.end_time
      break_rows = normalize_breaks(raw_breaks, work_date: work_date, start_time: start_time, end_time: end_time) if raw_breaks
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
        [ hour, minute ]
      else
        parsed = Time.iso8601(value.to_s).in_time_zone(TimeClockService::BUSINESS_TIMEZONE)
        [ parsed.hour, parsed.min ]
      end
      zone = ActiveSupport::TimeZone[TimeClockService::BUSINESS_TIMEZONE]
      result = zone.local(work_date.year, work_date.month, work_date.day, local.first, local.last)
      result += 1.day if after && result <= after
      result
    rescue ArgumentError
      raise CorrectionError, "Corrected times must use HH:MM or ISO 8601"
    end

    def relocate_time(value, work_date, after: nil)
      return unless value

      local = value.in_time_zone(TimeClockService::BUSINESS_TIMEZONE)
      zone = ActiveSupport::TimeZone[TimeClockService::BUSINESS_TIMEZONE]
      result = zone.local(work_date.year, work_date.month, work_date.day, local.hour, local.min)
      result += 1.day if after && result <= after
      result
    end

    def normalize_breaks(values, work_date:, start_time:, end_time:)
      raise CorrectionError, "Complete the missing clock-out before correcting breaks" unless start_time && end_time

      rows = Array(values).map do |value|
        value = value.to_h.symbolize_keys
        raise CorrectionError, "Each break needs a start and end time" if value[:start_time].blank? || value[:end_time].blank?

        break_start = parse_time(value[:start_time], work_date)
        break_end = parse_time(value[:end_time], work_date, after: break_start)
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
      entry.time_entry_breaks.destroy_all
      rows.each { |attributes| entry.time_entry_breaks.create!(attributes) }
    end

    def audit_snapshot(record)
      {
        work_date: record.work_date.iso8601,
        start_time: record.start_time&.iso8601,
        end_time: record.end_time&.iso8601,
        hours: record.hours.to_f,
        break_minutes: record.break_minutes.to_i,
        time_category_id: record.time_category_id,
        approval_status: record.approval_status,
        status: record.status,
        breaks: record.time_entry_breaks.order(:start_time, :id).map do |entry_break|
          {
            start_time: entry_break.start_time.iso8601,
            end_time: entry_break.end_time&.iso8601,
            duration_minutes: entry_break.duration_minutes
          }
        end
      }
    end
  end
end
