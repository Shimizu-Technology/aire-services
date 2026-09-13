# frozen_string_literal: true

class PayrollSettlementCaseEvent < ApplicationRecord
  EVENT_TYPES = %w[
    opened routed rerouted corrected approval_changed included imported committed
    payment_prepared payment_issued payment_failed payment_voided payment_returned settled
    marked_not_payable superseded
  ].freeze

  belongs_to :payroll_settlement_case
  belongs_to :actor, class_name: "User", optional: true

  validates :event_id, :event_type, :to_status, :occurred_at, presence: true
  validates :event_id, uniqueness: true
  validates :event_type, inclusion: { in: EVENT_TYPES }
  validates :from_status, inclusion: { in: PayrollSettlementCase::STATUSES }, allow_nil: true
  validates :to_status, inclusion: { in: PayrollSettlementCase::STATUSES }

  def readonly?
    persisted?
  end
end
