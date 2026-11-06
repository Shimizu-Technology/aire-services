# frozen_string_literal: true

class PayrollLateHoursRetirement < ApplicationRecord
  belongs_to :origin_payroll_calendar_period, class_name: "PayrollCalendarPeriod"
  belongs_to :payroll_batch, optional: true
  belongs_to :actor, class_name: "User"

  validates :original_command_id, format: { with: PayrollIntegrationCommand::UUID_FORMAT }, uniqueness: true
  validates :target_external_pay_period_id, format: { with: /\A[1-9]\d*\z/ }, uniqueness: true
  validates :reason, presence: true
  validates :status, inclusion: { in: %w[no_claim canceled] }

  def readonly?
    persisted?
  end
end
