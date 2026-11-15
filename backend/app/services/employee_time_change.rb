# frozen_string_literal: true

class EmployeeTimeChange
  class Stale < StandardError; end
  FIELDS = %w[work_date start_time end_time clock_in_at clock_out_at hours break_minutes description time_category_id status approval_status approved_by_id approved_at approval_note overtime_status overtime_approved_by_id overtime_approved_at overtime_note].freeze

  def self.capture(entry)
    return unless entry.clock_entry?

    serialize = ->(attrs) { attrs.transform_values { |value| value.respond_to?(:iso8601) && !value.is_a?(Date) ? value.iso8601(6) : value } }
    serialize.call(entry.attributes.slice(*FIELDS)).merge("breaks" => entry.time_entry_breaks.map { |row| serialize.call(row.attributes.slice("start_time", "end_time", "duration_minutes")) })
  end

  def self.presentation(entry)
    original = entry.original_employee_change
    return unless entry.clock_entry? && original.present?

    zone = TimeClockService::BUSINESS_TIMEZONE
    first = Time.iso8601(original.fetch("clock_in_at")).in_time_zone(zone)
    last = Time.iso8601(original.fetch("clock_out_at")).in_time_zone(zone)
    end_format = first.to_date == last.to_date ? "%-I:%M %p" : "%a, %b %-d, %-I:%M %p"
    original.slice("start_time", "end_time", "clock_in_at", "clock_out_at", "hours").merge(
      "formatted_range" => "#{first.strftime('%a, %b %-d, %-I:%M %p')}–#{last.strftime(end_format)}"
    )
  rescue KeyError, ArgumentError, TypeError
    nil
  end

  def self.reject!(entry:, actor:, version:, note:)
    raise TimeClockService::AuthorizationError, "Another approver must review this shift" unless actor.can_approve_time? && actor.can_review_time_of?(entry.user_id)
    raise TimeClockService::ClockError, "Say why the change wasn't approved" if note.to_s.strip.blank?
    TimeEntry.transaction do
      User.lock_employees!([ entry.user_id ])
      entry.lock!
      raise Stale, "This shift changed. Reload it before reviewing." unless version.to_s.match?(/\A\d+\z/) && entry.lock_version == version.to_i
      original = entry.original_employee_change
      raise TimeClockService::ClockError, "There is no pending employee change to reject" unless entry.clock_entry? && original.present? && entry.pending_approval?
      Payroll::AffectedOvertimeReview.around(entry, force: true) do
        before = capture(entry)
        entry.assign_attributes(original.slice(*FIELDS))
        entry.calculate_hours_from_times
        if entry.needs_administrator_correction? || entry.clock_in_at.nil? || entry.clock_out_at.nil? || entry.hours.to_f <= 0 || !entry.valid?
          raise TimeClockService::ClockError, "The original clock-out was missing, so there's nothing to go back to. Approve the employee's fix or edit the shift."
        end
        # Restore the original time decision; rejecting a change never approves
        # pending time. OT requires a fresh allocation review.
        entry.assign_attributes(original_employee_change: nil,
                                rejected_employee_change: { note: note.to_s.strip, manager: actor.full_name, at: Time.current.iso8601 },
                                overtime_status: "pending", overtime_approved_by: nil, overtime_approved_at: nil, overtime_note: nil)
        overlap = TimeEntryOverlap.error_for(entry, actor: actor)
        raise TimeClockService::ClockError, overlap if overlap
        entry.save!
        entry.time_entry_breaks.destroy_all
        original.fetch("breaks").each { |attrs| entry.time_entry_breaks.create!(attrs) }
        entry.update!(overtime_status: TimeClockService.check_overtime_status(entry.user, entry))
        if before["approval_status"] != entry.approval_status
          TimeClockService.record_review_event!("time_entry.#{entry.approval_status}", entry, actor, note,
                                               metadata: { restored_employee_change: true })
          TimeClockService.record_payroll_case_approval_event!(entry, actor, entry.approval_status, note)
        end
        AuditLog.record!(action: "time_entry.change_rejected", auditable: entry, actor: actor,
                         event_category: "approvals", metadata: { employee_id: entry.user_id, employee_name: entry.user.full_name,
                         work_date: entry.work_date.iso8601, note: note.to_s.strip, before: before, restored: capture(entry) })
        ReportExport.invalidate_for_entry!(entry_id: entry.id, changed_by: actor, reason: "Employee change rejected: #{note.to_s.strip}")
      end
    end
    entry
  end
end
