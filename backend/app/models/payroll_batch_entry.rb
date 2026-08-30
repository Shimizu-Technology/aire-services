# frozen_string_literal: true

class PayrollBatchEntry < ApplicationRecord
  SOURCE_KINDS = %w[current carryover correction].freeze

  belongs_to :payroll_batch

  validates :source_time_entry_id, :source_user_id, :work_date, :week_start, :line_key, presence: true
  validates :line_key, uniqueness: { scope: [ :payroll_batch_id, :source_time_entry_id ] }
  validates :source_kind, inclusion: { in: SOURCE_KINDS }

  def readonly?
    persisted?
  end
end
