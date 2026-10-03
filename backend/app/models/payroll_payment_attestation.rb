# frozen_string_literal: true

class PayrollPaymentAttestation < ApplicationRecord
  belongs_to :time_entry
  belongs_to :user
  belongs_to :recorded_by, class_name: "User"
  belongs_to :retracted_by, class_name: "User", optional: true
  has_many :payroll_payment_attestation_events, dependent: :restrict_with_error

  scope :pending_evidence, -> { where(status: "pending_evidence") }

  validates :status, inclusion: { in: %w[pending_evidence retracted] }
  validates :source_user_uuid, :source_time_entry_version, :work_date, :reason, :attested_at, presence: true
  validates :hours, numericality: { greater_than: 0 }
  validate :source_identity_is_stable, on: :create

  def source_changed?
    time_entry.lock_version != source_time_entry_version ||
      time_entry.user_id != user_id ||
      user.payroll_integration_uuid != source_user_uuid
  end

  private

  def source_identity_is_stable
    return if time_entry.nil? || user.nil?
    return if time_entry.user_id == user_id && source_user_uuid == user.payroll_integration_uuid

    errors.add(:base, "Payment attestation must retain the AIRE time-entry identity")
  end
end
