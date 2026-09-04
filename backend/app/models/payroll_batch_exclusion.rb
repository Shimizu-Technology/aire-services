# frozen_string_literal: true

class PayrollBatchExclusion < ApplicationRecord
  REASONS = %w[
    pending_approval denied_approval open_clock pending_overtime denied_overtime
    created_after_cutoff approved_after_cutoff overtime_approved_after_cutoff
  ].freeze
  CARRYOVER_REASONS = %w[
    pending_approval open_clock pending_overtime created_after_cutoff
    approved_after_cutoff overtime_approved_after_cutoff
  ].freeze

  belongs_to :payroll_batch

  validates :source_time_entry_id, :source_user_id, :reason, presence: true
  validates :source_user_uuid,
            format: { with: /\A[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\z/i },
            allow_nil: true
  validates :reason, inclusion: { in: REASONS }
  validates :reason, uniqueness: { scope: [ :payroll_batch_id, :source_time_entry_id ] }

  def readonly?
    persisted?
  end
end
