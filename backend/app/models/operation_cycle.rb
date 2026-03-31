# frozen_string_literal: true

class OperationCycle < ApplicationRecord
  STATUSES = %w[active completed cancelled].freeze
  GENERATION_MODES = %w[auto manual].freeze

  belongs_to :client
  belongs_to :operation_template
  belongs_to :client_operation_assignment, optional: true
  belongs_to :generated_by, class_name: "User", optional: true

  has_many :operation_tasks, dependent: :destroy, inverse_of: :operation_cycle

  validates :period_start, :period_end, :cycle_label, presence: true
  validates :status, inclusion: { in: STATUSES }
  validates :generation_mode, inclusion: { in: GENERATION_MODES }
  validates :operation_template_id, uniqueness: { scope: [:client_id, :period_start, :period_end] }
  validate :period_range_is_valid

  scope :active, -> { where(status: "active") }
  scope :recent_first, -> { order(period_start: :desc, created_at: :desc) }

  private

  def period_range_is_valid
    return if period_start.blank? || period_end.blank? || period_end >= period_start

    errors.add(:period_end, "must be on or after period start")
  end
end
