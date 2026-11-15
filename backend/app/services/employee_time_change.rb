# frozen_string_literal: true

class EmployeeTimeChange
  class Stale < StandardError; end
  FIELDS = %w[work_date start_time end_time clock_in_at clock_out_at hours break_minutes description time_category_id status approval_status approved_by_id approved_at approval_note overtime_status overtime_approved_by_id overtime_approved_at overtime_note].freeze

  def self.capture(entry)
    entry.attributes.slice(*FIELDS).merge("breaks" => entry.time_entry_breaks.map { |row| row.attributes.slice("start_time", "end_time", "duration_minutes") })
  end

  def self.reject!(entry:, actor:, version:, note:)
    raise TimeClockService::AuthorizationError, "Another approver must review this shift" unless actor.can_approve_time? && actor.can_review_time_of?(entry.user_id)
    raise TimeClockService::ClockError, "Say why the change wasn't approved" if note.to_s.strip.blank?
    entry.with_lock do
      raise Stale, "This shift changed. Reload it before reviewing." unless version.to_s.match?(/\A\d+\z/) && entry.lock_version == version.to_i
      original = entry.original_employee_change
      raise TimeClockService::ClockError, "There is no pending employee change to reject" unless original.present? && entry.pending_approval?
      Payroll::AffectedOvertimeReview.around(entry, force: true) do
        before = capture(entry)
        entry.assign_attributes(original.slice(*FIELDS))
        # Approve the restored worked time explicitly. OT always needs a fresh
        # allocation review; restoring a stale OT approval could approve new hours.
        entry.assign_attributes(approval_status: "approved", approved_by: actor, approved_at: Time.current,
                                approval_note: note.to_s.strip, original_employee_change: nil,
                                rejected_employee_change: { note: note.to_s.strip, manager: actor.full_name, at: Time.current.iso8601 },
                                overtime_status: "pending", overtime_approved_by: nil, overtime_approved_at: nil, overtime_note: nil)
        overlap = TimeEntryOverlap.error_for(entry, actor: actor)
        raise TimeClockService::ClockError, overlap if overlap
        entry.save!
        entry.time_entry_breaks.destroy_all
        original.fetch("breaks").each { |attrs| entry.time_entry_breaks.create!(attrs) }
        entry.update!(overtime_status: TimeClockService.check_overtime_status(entry.user, entry))
        AuditLog.record!(action: "time_entry.change_rejected", auditable: entry, actor: actor,
                         event_category: "time_tracking", metadata: { note: note.to_s.strip, before: before, restored: capture(entry) })
        ReportExport.invalidate_for_entry!(entry_id: entry.id, changed_by: actor, reason: "Employee change rejected: #{note.to_s.strip}")
      end
    end
    entry
  end
end
