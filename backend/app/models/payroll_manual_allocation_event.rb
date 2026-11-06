# frozen_string_literal: true

class PayrollManualAllocationEvent < ApplicationRecord
  EVENT_TYPES = %w[committed issued voided payment_cancelled].freeze

  belongs_to :payroll_manual_allocation
  belongs_to :actor, class_name: "User"

  validates :event_type, :occurred_at, :reason, presence: true
  validates :event_type, inclusion: { in: EVENT_TYPES }

  validates :cancellation_evidence_reference, :payment_method, :payment_reference, presence: true, if: -> { event_type == "payment_cancelled" }
  validates :cancellation_evidence_reference, length: { maximum: 200 }, allow_nil: true

  def readonly?
    persisted?
  end
end
