# frozen_string_literal: true

class PayrollObligationCorrection < ApplicationRecord
  belongs_to :payroll_batch_entry
  belongs_to :predecessor_event, class_name: "PayrollEntryProcessingEvent"
  validates :command_id, :request_digest, :external_system, :successor_pay_period_id, :successor_payroll_item_id, :command, presence: true
  validates :command_id, uniqueness: true

  def readonly?
    persisted?
  end

  def receipt
    { binding_id: id.to_s, request_digest: request_digest, command: command }
  end
end
