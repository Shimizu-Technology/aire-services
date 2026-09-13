# frozen_string_literal: true

class PayrollSettlementReconciliation < ApplicationRecord
  belongs_to :payroll_calendar_period

  validates :payroll_calendar_period_id, uniqueness: true
  validates :reconciled_at, presence: true
end
