# frozen_string_literal: true

module Approvals
  # Approving or undoing time recalculates the week's overtime, which can move
  # another shift's approved overtime back to waiting (or clear it when the
  # overtime is gone). That happens in Payroll::AffectedOvertimeReview without
  # an audit row, so this records one per shift it reset.
  class OvertimeResetAudit
    ACTION = "time_entry.overtime_reset"

    # Snapshots approved overtime in the affected employees' weeks (and the
    # weeks either side, which the recalculation can reach), runs the block,
    # then audits every one that is no longer approved. except_ids are shifts
    # the caller changes on purpose and audits itself.
    def self.around(entries, actor:, metadata:, except_ids: [])
      return yield if entries.empty?

      dates = entries.map(&:work_date)
      range = (dates.min.beginning_of_week(:sunday) - 7)..(dates.max.end_of_week(:sunday) + 7)
      approved = TimeEntry.where(user_id: entries.map(&:user_id).uniq, work_date: range, overtime_status: "approved")
        .where.not(id: except_ids).pluck(:id, :overtime_approved_by_id).to_h
      result = yield
      record!(approved, actor: actor, metadata: metadata) if approved.any?
      result
    end

    def self.record!(approved, actor:, metadata:)
      TimeEntry.where(id: approved.keys).where.not(overtime_status: "approved").includes(:user).order(:id).each do |entry|
        AuditLog.record!(
          action: ACTION,
          auditable: entry,
          actor: actor,
          event_category: "approvals",
          source: "admin",
          metadata: {
            employee_id: entry.user_id,
            employee_name: entry.user&.full_name,
            work_date: entry.work_date&.iso8601,
            overtime_status: entry.overtime_status,
            previous_overtime_approved_by_id: approved[entry.id]
          }.compact.merge(metadata)
        )
      end
    end
    private_class_method :record!
  end
end
