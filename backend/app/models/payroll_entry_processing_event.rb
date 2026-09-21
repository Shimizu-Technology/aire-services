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
  validate :valid_payment_effective_on

  def readonly?
    persisted?
  end

  private

  def valid_payment_effective_on
    value = metadata&.fetch("payment_effective_on", nil)
    return if value.blank?

    date = Date.iso8601(value)
    errors.add(:metadata, "payment date cannot be in the future") if date > Time.zone.today
  rescue ArgumentError, TypeError
    errors.add(:metadata, "payment date must use YYYY-MM-DD")
  end
end
