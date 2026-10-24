# frozen_string_literal: true

class PayrollBatchEntry < ApplicationRecord
  SOURCE_KINDS = %w[current carryover correction].freeze

  belongs_to :payroll_batch

  validates :source_time_entry_id, :source_user_id, :work_date, :week_start, :line_key, presence: true
  validates :source_user_uuid,
            format: { with: /\A[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\z/i },
            allow_nil: true
  validates :line_key, uniqueness: { scope: [ :payroll_batch_id, :source_time_entry_id ] }
  validates :source_kind, inclusion: { in: SOURCE_KINDS }

  # Retain every frozen row for audit. Only retired, never-applied claims cease
  # to represent wages in the live ledger.
  scope :effective, -> { where.not(payroll_batch_id: PayrollLateHoursRetirement.where(status: "canceled").where.not(payroll_batch_id: nil).select(:payroll_batch_id)) }

  def readonly?
    persisted?
  end
end
