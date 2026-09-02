# frozen_string_literal: true

class PayrollBatchProcessingEvent < ApplicationRecord
  STATUSES = %w[imported committed payment_issued payment_failed].freeze
  STATUS_RANK = {
    "imported" => 10,
    "committed" => 20,
    "payment_issued" => 30,
    "payment_failed" => 40
  }.freeze

  belongs_to :payroll_batch

  validates :event_id, :status, :external_system, :occurred_at, presence: true
  validates :event_id, uniqueness: true, length: { maximum: 200 }
  validates :status, inclusion: { in: STATUSES }
  validates :external_system, length: { maximum: 100 }
  validates :external_pay_period_id, length: { maximum: 200 }, allow_nil: true

  def readonly?
    persisted?
  end
end
