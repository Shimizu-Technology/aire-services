# frozen_string_literal: true

class TerminationPreview
  def self.open_leave(user, effective_on:)
    user.leave_requests.where(status: "pending").or(user.leave_requests.where(status: "approved").where("start_date > ?", effective_on))
  end

  def self.for(user, effective_on:)
    entries = user.time_entries.where(status: "completed").includes(:time_entry_breaks).to_a
    calculator = Payroll::ApprovalHours.for_entries(entries)
    rows = entries.map { |entry| calculator.for(entry) }
    hours = Payroll::ApprovalHours.sum(rows)
    {
      admin_edit_version: user.admin_edit_version,
      waiting_shifts: rows.count { |row| row[:time_waiting_hours].positive? },
      waiting_hours: hours[:time_waiting_hours],
      waiting_overtime_hours: hours[:overtime_waiting_hours],
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
