# frozen_string_literal: true

class PayrollPaymentAttestation < ApplicationRecord
  belongs_to :time_entry
  belongs_to :user
  belongs_to :recorded_by, class_name: "User"
  belongs_to :retracted_by, class_name: "User", optional: true
  belongs_to :resolved_by, class_name: "User", optional: true
  belongs_to :resolved_manual_allocation, class_name: "PayrollManualAllocation", optional: true
  belongs_to :resolved_issued_event, class_name: "PayrollManualAllocationEvent", optional: true
  has_many :payroll_payment_attestation_events, dependent: :restrict_with_error

  scope :pending_evidence, -> { where(status: "pending_evidence") }
  # A late first finalizer must preserve a hold that was released after its
  # cutoff. Current holds remain conservative, including those reported late.
  scope :blocking_at, ->(cutoff) {
    where("status = 'pending_evidence' OR (status = 'retracted' AND retracted_at > ?) OR (status = 'resolved' AND resolved_at > ?)", cutoff, cutoff)
  }

  validates :status, inclusion: { in: %w[pending_evidence retracted resolved] }
  validates :resolved_at, :resolved_by, :resolved_manual_allocation, :resolved_issued_event, :resolution_reason,
            presence: true, if: -> { status == "resolved" }
  validate :resolution_has_exact_issued_evidence
  validates :source_user_uuid, :source_time_entry_version, :work_date, :reason, :attested_at, presence: true
  validates :hours, numericality: { greater_than: 0 }
  validate :source_identity_is_stable, on: :create

  def source_changed?
    time_entry.lock_version != source_time_entry_version ||
      time_entry.user_id != user_id ||
      user.payroll_integration_uuid != source_user_uuid
  end

  private

  def resolution_has_exact_issued_evidence
    return unless status == "resolved"

    allocation = resolved_manual_allocation
    event = resolved_issued_event
    return if allocation && event && allocation.time_entry_id == time_entry_id &&
      allocation.source_user_uuid == source_user_uuid && allocation.source_time_entry_version == source_time_entry_version &&
      allocation.work_date == work_date && allocation.total_hours == hours.to_d &&
      event.payroll_manual_allocation_id == allocation.id && event.event_type == "issued"

    errors.add(:base, "Payment report resolution must retain exact source allocation and immutable issued evidence")
  end

  def source_identity_is_stable
    return if time_entry.nil? || user.nil?
    return if time_entry.user_id == user_id && source_user_uuid == user.payroll_integration_uuid

    errors.add(:base, "Payment attestation must retain the AIRE time-entry identity")
  end
end
