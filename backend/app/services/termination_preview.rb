# frozen_string_literal: true

class TerminationPreview
  def self.open_leave(user, effective_on:)
    user.leave_requests.where(status: "pending").or(user.leave_requests.where(status: "approved").where("start_date > ?", effective_on))
  end

  def self.for(user, effective_on:)
    waiting = user.time_entries.where(status: "completed", approval_status: "pending")
    overtime = user.time_entries.where(status: "completed", overtime_status: "pending").to_a
    allocations = Payroll::AffectedOvertimeReview.projected_allocations_for(overtime)
    {
      admin_edit_version: user.admin_edit_version,
      waiting_shifts: waiting.count,
      waiting_hours: waiting.sum(:hours).to_f,
      waiting_overtime_hours: overtime.sum { |entry| allocations[entry.id].to_h.fetch(:overtime_hours, 0).to_f }.round(2),
      open_clock: user.time_entries.where(status: %w[clocked_in on_break]).exists?,
      open_pay_stub_links: user.pay_document_deliveries.unrevoked_open.count,
      open_pay_stub_requests: user.pay_document_requests.open_requests.count,
      open_leave_requests: open_leave(user, effective_on: effective_on).count,
      pending_leave_requests: user.leave_requests.where(status: "pending").count,
      approved_leave_requests: user.leave_requests.where(status: "approved").where("start_date > ?", effective_on).count,
      effective_on: effective_on.iso8601
    }
  end
end
