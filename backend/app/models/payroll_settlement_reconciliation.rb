# frozen_string_literal: true

class PayrollSettlementReconciliation < ApplicationRecord
  belongs_to :payroll_calendar_period

  # The unique database index arbitrates concurrent create_or_find_by! calls.
  # A model uniqueness validation would reject normal repeat scans before Rails
  # can recover the existing marker from the database constraint.
  validates :reconciled_at, presence: true
end
