# frozen_string_literal: true

class PayrollBatch < ApplicationRecord
  SCHEMA_VERSION = "2.0"

  belongs_to :finalized_by, class_name: "User", optional: true
  has_many :payroll_batch_entries, dependent: :restrict_with_error
  has_many :payroll_batch_exclusions, dependent: :restrict_with_error
  has_many :payroll_batch_processing_events, dependent: :restrict_with_error
  has_many :payroll_entry_processing_events, dependent: :restrict_with_error

  validates :public_id, :start_date, :end_date, :cutoff_at, :finalized_at, :checksum, presence: true
  validates :public_id, uniqueness: true
  validates :schema_version, inclusion: { in: [ SCHEMA_VERSION ] }
  validate :end_date_on_or_after_start_date

  def readonly?
    persisted?
  end

  def export_payload
    payload.deep_dup.merge(
      "export" => {
        "id" => public_id,
        "batch_id" => public_id,
        "checksum" => checksum,
        "checksum_algorithm" => "SHA-256",
        "checksum_scope" => "payload_without_export",
        "readiness_status" => "finalized",
        "cutoff_at" => cutoff_at.iso8601,
        "finalized_at" => finalized_at.iso8601
      }
    )
  end

  def processing_status
    events = payroll_batch_processing_events.to_a
    payment_events = events.select { |candidate| candidate.status.in?(%w[payment_issued payment_failed]) }
    event = if payment_events.any?
      payment_events.max_by { |candidate| [ candidate.occurred_at, candidate.id ] }
    else
      events.max_by do |candidate|
        [ PayrollBatchProcessingEvent::STATUS_RANK.fetch(candidate.status), candidate.occurred_at, candidate.id ]
      end
    end
    return nil unless event

    {
      status: event.status,
      occurred_at: event.occurred_at.iso8601,
      external_system: event.external_system,
      external_pay_period_id: event.external_pay_period_id
    }
  end

  private

  def end_date_on_or_after_start_date
    return if start_date.blank? || end_date.blank? || end_date >= start_date

    errors.add(:end_date, "must be on or after start date")
  end
end
