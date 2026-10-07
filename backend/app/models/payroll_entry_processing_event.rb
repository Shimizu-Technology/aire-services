# frozen_string_literal: true

class PayrollEntryProcessingEvent < ApplicationRecord
  LINE_CONTRACT_VERSION = "2.0"
  SOURCE_KINDS = %w[current carryover correction].freeze
  STATUSES = %w[
    imported committed payment_prepared payment_issued payment_failed payment_voided payment_cancelled
  ].freeze
  STATUS_RANK = STATUSES.each_with_index.to_h.freeze

  def self.latest(events)
    candidates = Array(events)
    cancellations = candidates.select { |event| event.status == "payment_cancelled" }
    cancellation_present = cancellations.any?
    # Cancellation is a tombstone for one physical instrument, not a release
    # of payroll ownership. Delayed old issuance cannot resurrect that check.
    candidates = candidates.reject do |event|
      cancellations.any? do |cancellation|
        (event.status.in?(%w[payment_prepared payment_issued payment_failed]) && same_cancelled_instrument?(event, cancellation)) ||
          (event.status.in?(%w[imported committed]) && same_cancelled_obligation?(event, cancellation))
      end
    end
    candidates.max_by do |event|
      rank = STATUS_RANK.fetch(event.status)
      if cancellation_present && event.status.in?(%w[payment_prepared payment_issued payment_cancelled])
        rank = STATUS_RANK.fetch("payment_cancelled")
      end
      [ event.occurred_at, rank, event.id ]
    end
  end

  def self.same_cancelled_instrument?(event, cancellation)
    event.payment_method == cancellation.payment_method && event.payment_reference == cancellation.payment_reference &&
      same_cancelled_obligation?(event, cancellation)
  end

  def self.same_cancelled_obligation?(event, cancellation)
    exact = %i[payroll_batch_id source_time_entry_id external_system external_pay_period_id external_payroll_item_id]
    exact.all? { |field| event.public_send(field) == cancellation.public_send(field) } &&
      (event.source_line_key.blank? || event.source_line_key == cancellation.source_line_key) &&
      (event.source_user_uuid.blank? || event.source_user_uuid == cancellation.source_user_uuid)
  end

  belongs_to :payroll_batch

  validates :event_id, :source_time_entry_id, :status, :external_system, :occurred_at, presence: true
  validates :event_id, uniqueness: true, length: { maximum: 200 }
  validates :status, inclusion: { in: STATUSES }
  validates :external_system, length: { maximum: 100 }
  validates :external_pay_period_id, :external_payroll_item_id, length: { maximum: 200 }, allow_nil: true
  validates :contract_version, inclusion: { in: [ LINE_CONTRACT_VERSION ] }, allow_nil: true
  validates :source_line_key, presence: true, if: :line_contract?
  validates :source_kind, inclusion: { in: SOURCE_KINDS }, if: :line_contract?
  validates :total_hours, :regular_hours, :overtime_hours, numericality: true, if: :line_contract?
  validates :source_user_uuid,
            format: { with: /\A[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\z/i },
            allow_nil: true
  validates :payment_method, length: { maximum: 50 }, allow_nil: true
  validates :payment_reference, length: { maximum: 200 }, allow_nil: true
  validate :line_contract_shape
  validate :valid_payment_effective_on


  def readonly?
    persisted?
  end

  def line_contract?
    contract_version == LINE_CONTRACT_VERSION
  end

  private

  def line_contract_shape
    line_fields = [ source_line_key, source_kind, total_hours, regular_hours, overtime_hours ]
    if contract_version.nil?
      errors.add(:contract_version, "is required for payable-line fields") if line_fields.any?(&:present?)
      return
    end
    return unless line_contract? && total_hours.present? && regular_hours.present? && overtime_hours.present?
    return if total_hours == regular_hours + overtime_hours

    errors.add(:total_hours, "must equal regular plus overtime hours")
  end

  def valid_payment_effective_on
    value = metadata&.fetch("payment_effective_on", nil)
    return if value.blank?

    date = Date.iso8601(value)
    errors.add(:metadata, "payment date cannot be in the future") if date > Time.current.in_time_zone("Pacific/Guam").to_date
  rescue ArgumentError, TypeError
    errors.add(:metadata, "payment date must use YYYY-MM-DD")
  end
end
