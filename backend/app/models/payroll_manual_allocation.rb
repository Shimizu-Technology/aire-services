# frozen_string_literal: true

class PayrollManualAllocation < ApplicationRecord
  STATUSES = %w[committed issued voided].freeze
  ACTIVE_STATUSES = %w[committed issued].freeze

  belongs_to :time_entry
  belongs_to :user
  belongs_to :recorded_by, class_name: "User"
  has_many :payroll_manual_allocation_events, dependent: :restrict_with_error

  scope :active, -> { where(status: ACTIVE_STATUSES) }

  validates :source_user_uuid, :source_time_entry_version, :work_date, :pay_date,
            :external_pay_period_id, :external_payroll_item_id, :reason, presence: true
  validates :status, inclusion: { in: STATUSES }
  validates :regular_hours, :overtime_hours, numericality: { greater_than_or_equal_to: 0 }
  validate :positive_total_hours
  validate :time_entry_identity

  def total_hours
    regular_hours.to_d + overtime_hours.to_d
  end

  private

  def positive_total_hours
    return if regular_hours.blank? || overtime_hours.blank? || total_hours.positive?

    errors.add(:base, "Allocate at least some regular or overtime time")
  end

  def time_entry_identity
    return if time_entry.nil? || user.nil?
    return if time_entry.user_id == user.id && source_user_uuid == user.payroll_integration_uuid

    errors.add(:base, "Manual allocation must retain the AIRE time entry identity")
  end
end
