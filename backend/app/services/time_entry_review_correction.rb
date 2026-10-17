# frozen_string_literal: true

# Explicit admin remediation of an exact source entry. Neither transition approves
# time or changes the immutable payroll snapshot that originally excluded it.
class TimeEntryReviewCorrection
  class CorrectionError < StandardError; end
  class StaleEntryError < CorrectionError; end

  def self.call(entry:, actor:, action:, attributes:, reason:)
    new(entry: entry, actor: actor, action: action, attributes: attributes, reason: reason).call
  end

  def initialize(entry:, actor:, action:, attributes:, reason:)
    @entry, @actor, @action = entry, actor, action
    @attributes = attributes.to_h.symbolize_keys
    @reason = reason.to_s.strip
  end

  def call
    raise CorrectionError, "Only admins can submit this correction" unless actor.admin?
    raise CorrectionError, "A correction reason is required" if reason.blank?
    version = attributes[:expected_version]
    raise StaleEntryError, "Reload this entry before submitting the correction" unless version.to_s.match?(/\A\d+\z/)

    entry.with_lock do
      raise StaleEntryError, "This entry changed. Reload it before submitting the correction" unless entry.lock_version == version.to_i
      before = snapshot
      case action
      when "end_clock" then end_clock!
      when "resubmit_denied" then resubmit_denied!
      else raise CorrectionError, "Unknown review action"
      end
      entry.approval_status = "pending"
      entry.approved_by = nil
      entry.approved_at = nil
      entry.approval_note = [ entry.approval_note.presence, "Submitted for review by #{actor.full_name}: #{reason}" ].compact.join(" | ")
      entry.overtime_status = TimeClockService.check_overtime_status(entry.user, entry)
      entry.overtime_approved_by = nil
      entry.overtime_approved_at = nil
      entry.overtime_note = nil
      entry.save!
      AuditLog.record!(
        action: action == "end_clock" ? "time_entry.clock_ended" : "time_entry.denied_resubmitted",
        auditable: entry, actor: actor, event_category: "time_tracking",
        metadata: { correction_reason: reason, before: before, after: snapshot,
                    requires_approval: true, finalized_payroll_batch_ids: entry.finalized_payroll_batches.map(&:public_id) }
      )
      ReportExport.invalidate_for_entry!(entry_id: entry.id, correction_reason: reason, changed_by: actor)
      entry
    end
  rescue ActiveRecord::RecordInvalid => e
    raise CorrectionError, e.record.errors.full_messages.to_sentence
  end

  private

  attr_reader :entry, :actor, :action, :attributes, :reason

  def end_clock!
    raise CorrectionError, "Only an active clock entry can be ended" unless entry.clock_entry? && entry.active?
    category = entry.user.assigned_time_categories.active.find_by(id: attributes[:time_category_id])
    raise CorrectionError, "Choose an active work category assigned to this person" unless category
    date = Date.iso8601(attributes[:stop_date].to_s)
    match = attributes[:end_time].to_s.match(/\A(\d{2}):(\d{2})\z/)
    raise CorrectionError, "Clock-out time must use HH:MM" unless match && match[1].to_i.between?(0, 23) && match[2].to_i.between?(0, 59)
    stop = ActiveSupport::TimeZone[TimeClockService::BUSINESS_TIMEZONE].local(date.year, date.month, date.day, match[1].to_i, match[2].to_i)
    start = entry.clock_in_at || entry.start_time
    raise CorrectionError, "Clock-out must be after clock-in" unless start && stop > start
    raise CorrectionError, "Clock-out time cannot be in the future" if stop > Time.current
    raise CorrectionError, "A clock entry cannot span more than 24 hours; correct the clock-in first" if stop - start > 24.hours

    breaks = entry.time_entry_breaks.order(:start_time, :id).lock.to_a
    breaks.each do |entry_break|
      ending = entry_break.end_time || stop
      unless entry_break.start_time >= start && ending <= stop && ending > entry_break.start_time
        raise CorrectionError, "Breaks must fall within the clock-in and clock-out time"
      end
    end
    breaks.each_cons(2) do |left, right|
      raise CorrectionError, "Breaks cannot overlap" if (left.end_time || stop) > right.start_time
    end
    breaks.each { |entry_break| entry_break.close!(stop) if entry_break.active? }
    minutes = breaks.empty? ? entry.break_minutes.to_i : breaks.sum { |entry_break| entry_break.duration_minutes.to_i }
    raise CorrectionError, "Break duration cannot be negative" if minutes.negative?
    raise CorrectionError, "Completed time must have positive hours after breaks" unless stop - start > minutes.minutes

    entry.assign_attributes(start_time: start, end_time: stop, clock_out_at: stop, status: "completed",
                            time_category: category, break_minutes: minutes, admin_override: true)
    entry.description = attributes[:description] if attributes.key?(:description)
    entry.calculate_hours_from_times
    raise CorrectionError, "Completed time must have positive hours after breaks" unless entry.hours.positive?
  rescue Date::Error
    raise CorrectionError, "Choose a valid clock-out date in Guam"
  end

  def resubmit_denied!
    unless entry.status == "completed" && entry.approval_status == "denied"
      raise CorrectionError, "Only completed denied time can be submitted for review"
    end
    category = entry.time_category
    unless category&.is_active? && entry.user.assigned_time_categories.active.exists?(id: entry.time_category_id)
      raise CorrectionError, "Choose an active work category assigned to this person"
    end
  end

  def snapshot
    entry.attributes.slice("description", "work_date", "start_time", "end_time", "clock_in_at", "clock_out_at", "hours", "break_minutes",
                           "status", "time_category_id", "approval_status", "approved_by_id", "approved_at", "approval_note",
                           "overtime_status", "overtime_approved_by_id", "overtime_approved_at", "overtime_note", "lock_version").merge(
      "breaks" => entry.time_entry_breaks.order(:start_time, :id).map { |entry_break|
        entry_break.attributes.slice("id", "start_time", "end_time", "duration_minutes")
      }
    )
  end
end
