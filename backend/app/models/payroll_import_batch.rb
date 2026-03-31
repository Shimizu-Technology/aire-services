# frozen_string_literal: true

class PayrollImportBatch < ApplicationRecord
  STATUSES = %w[pending reconciled failed].freeze

  validates :idempotency_key, presence: true, uniqueness: true
  validates :source_payroll_run_id, presence: true
  validates :payload, presence: true
  validates :status, inclusion: { in: STATUSES }
  validates :total_gross, :total_net, :total_tax, numericality: { greater_than_or_equal_to: 0 }, allow_nil: true
  validates :employee_count, numericality: { only_integer: true, greater_than_or_equal_to: 0 }, allow_nil: true

  scope :recent_first, -> { order(created_at: :desc) }
  scope :by_status, ->(status) { where(status: status) if status.present? }
end
