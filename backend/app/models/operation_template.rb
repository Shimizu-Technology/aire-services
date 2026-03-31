# frozen_string_literal: true

class OperationTemplate < ApplicationRecord
  RECURRENCE_TYPES = %w[weekly biweekly monthly quarterly custom].freeze
  CATEGORIES = %w[payroll bookkeeping compliance general custom].freeze

  belongs_to :created_by, class_name: "User", optional: true

  has_many :operation_template_tasks, dependent: :destroy
  has_many :client_operation_assignments, dependent: :destroy
  has_many :operation_cycles, dependent: :destroy

  validates :name, presence: true, uniqueness: true
  validates :recurrence_type, inclusion: { in: RECURRENCE_TYPES }
  validates :category, inclusion: { in: CATEGORIES }
  validates :recurrence_interval, numericality: { greater_than: 0, only_integer: true }, allow_nil: true
  validate :custom_recurrence_requires_interval

  scope :active, -> { where(is_active: true) }
  scope :ordered, -> { order(:name) }

  private

  def custom_recurrence_requires_interval
    return unless recurrence_type == "custom" && recurrence_interval.blank?

    errors.add(:recurrence_interval, "is required when recurrence type is custom")
  end
end
