# frozen_string_literal: true

class PayrollManualAllocationEvent < ApplicationRecord
  EVENT_TYPES = %w[committed issued voided].freeze

  belongs_to :payroll_manual_allocation
  belongs_to :actor, class_name: "User"

  validates :event_type, :occurred_at, :reason, presence: true
  validates :event_type, inclusion: { in: EVENT_TYPES }

  def readonly?
    persisted?
  end
end
