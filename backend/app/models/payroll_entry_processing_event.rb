# frozen_string_literal: true

class PayrollEntryProcessingEvent < ApplicationRecord
  STATUSES = %w[
    imported committed payment_prepared payment_issued payment_failed payment_voided
  ].freeze
  STATUS_RANK = STATUSES.each_with_index.to_h.freeze

  belongs_to :payroll_batch

  validates :event_id, :source_time_entry_id, :status, :external_system, :occurred_at, presence: true
  validates :event_id, uniqueness: true, length: { maximum: 200 }
  validates :status, inclusion: { in: STATUSES }
  validates :external_system, length: { maximum: 100 }
  validates :external_pay_period_id, :external_payroll_item_id, length: { maximum: 200 }, allow_nil: true
  validates :source_user_uuid,
            format: { with: /\A[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\z/i },
            allow_nil: true
  validates :payment_method, length: { maximum: 50 }, allow_nil: true
  validates :payment_reference, length: { maximum: 200 }, allow_nil: true

  def readonly?
    persisted?
  end
end
