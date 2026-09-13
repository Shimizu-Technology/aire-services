# frozen_string_literal: true

class PayrollSettlementCase < ApplicationRecord
  ORIGIN_REASONS = (PayrollBatchExclusion::REASONS + %w[changed_after_cutoff deleted_after_cutoff]).uniq.freeze
  DESTINATION_KINDS = %w[unassigned regular supplemental not_payable].freeze
  STATUSES = %w[open scheduled in_payroll settled not_payable superseded].freeze
  ACTIVE_STATUSES = %w[open scheduled in_payroll].freeze
  OWNER_ROLES = %w[aire_admins].freeze

  belongs_to :origin_payroll_batch,
             class_name: "PayrollBatch",
             inverse_of: :origin_payroll_settlement_cases
  belongs_to :origin_payroll_batch_exclusion,
             class_name: "PayrollBatchExclusion",
             inverse_of: :payroll_settlement_case,
             optional: true
  belongs_to :supersedes_case, class_name: "PayrollSettlementCase", optional: true
  belongs_to :target_payroll_calendar_period,
             class_name: "PayrollCalendarPeriod",
             inverse_of: :targeted_payroll_settlement_cases,
             optional: true
  belongs_to :included_payroll_batch,
             class_name: "PayrollBatch",
             inverse_of: :included_payroll_settlement_cases,
             optional: true
  belongs_to :assigned_to, class_name: "User", optional: true
  has_many :payroll_settlement_case_events, dependent: :restrict_with_error

  validates :public_id, :source_time_entry_id, :source_time_entry_version, :source_user_id, :origin_reason,
            :original_work_date, :destination_kind, :owner_role, :action_due_on, :status,
            presence: true
  validates :public_id, uniqueness: true
  validates :origin_reason, inclusion: { in: ORIGIN_REASONS }
  validates :destination_kind, inclusion: { in: DESTINATION_KINDS }
  validates :status, inclusion: { in: STATUSES }
  validates :owner_role, inclusion: { in: OWNER_ROLES }
  validates :held_total_hours, numericality: { greater_than_or_equal_to: 0 }
  validates :source_time_entry_version, numericality: { only_integer: true, greater_than_or_equal_to: 0 }
  validates :source_user_uuid,
            format: { with: /\A[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\z/i },
            allow_nil: true
  validate :destination_is_complete
  validate :included_state_is_complete
  validate :resolution_state_is_complete

  scope :active, -> { where(status: ACTIVE_STATUSES) }

  before_validation :set_public_id, on: :create

  private

  def set_public_id
    self.public_id ||= SecureRandom.uuid
  end

  def destination_is_complete
    if destination_kind == "regular"
      if target_payroll_calendar_period.blank? || target_external_pay_period_id.blank?
        errors.add(:base, "regular destinations require a named AIRE payroll period")
      end
    elsif destination_kind == "supplemental"
      errors.add(:target_external_pay_period_id, "is required for a supplemental payroll") if target_external_pay_period_id.blank?
      errors.add(:target_payroll_calendar_period, "must be blank for a supplemental payroll") if target_payroll_calendar_period.present?
    elsif destination_kind == "unassigned"
      errors.add(:status, "must be open while the destination is unassigned") unless status == "open"
      errors.add(:base, "unassigned cases cannot name a payroll period") if target_payroll_calendar_period.present? || target_external_pay_period_id.present?
    elsif destination_kind == "not_payable"
      errors.add(:status, "must be not_payable for a not-payable destination") unless status == "not_payable"
      errors.add(:base, "not-payable cases cannot name a payroll period") if target_payroll_calendar_period.present? || target_external_pay_period_id.present?
    end
  end

  def included_state_is_complete
    return unless status.in?(%w[in_payroll settled])
    return if included_payroll_batch_id.present? || destination_kind == "supplemental"

    errors.add(:included_payroll_batch, "is required after a regular case enters payroll")
  end

  def resolution_state_is_complete
    closed = status.in?(%w[settled not_payable superseded])
    return if closed == resolved_at.present?

    errors.add(:resolved_at, closed ? "is required for a closed case" : "must be blank for an active case")
  end
end
