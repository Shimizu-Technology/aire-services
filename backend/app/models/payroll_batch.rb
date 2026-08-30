# frozen_string_literal: true

class PayrollBatch < ApplicationRecord
  SCHEMA_VERSION = "2.0"

  belongs_to :finalized_by, class_name: "User", optional: true
  has_many :payroll_batch_entries, dependent: :restrict_with_error
  has_many :payroll_batch_exclusions, dependent: :restrict_with_error

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

  private

  def end_date_on_or_after_start_date
    return if start_date.blank? || end_date.blank? || end_date >= start_date

    errors.add(:end_date, "must be on or after start date")
  end
end
