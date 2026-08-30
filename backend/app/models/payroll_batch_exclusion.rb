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
  validates :reason, inclusion: { in: REASONS }
  validates :reason, uniqueness: { scope: [ :payroll_batch_id, :source_time_entry_id ] }

  def readonly?
    persisted?
  end
end
