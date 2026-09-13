# frozen_string_literal: true

class PayrollSettlementCaseCaptureJob < ApplicationJob
  queue_as :payroll

  def perform(time_entry_id, previous_work_date = nil, actor_id = nil)
    entry = TimeEntry.includes(:user, :time_category).find_by(id: time_entry_id)
    return unless entry

    Payroll::SettlementCaseCoordinator.record_entry!(entry, previous_work_date: previous_work_date, actor_id: actor_id)
  end
end
