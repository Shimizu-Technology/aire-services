# frozen_string_literal: true

class PayrollCutoffApprovalReminderJob < ApplicationJob
  queue_as :payroll

  def perform
    Payroll::CutoffApprovalReminder.call_due
  end
end
