# frozen_string_literal: true

class OperationTemplateTask < ApplicationRecord
  DUE_OFFSET_UNITS = %w[hours days].freeze
  DUE_OFFSET_FROM_OPTIONS = %w[cycle_start cycle_end].freeze

  belongs_to :operation_template
  belongs_to :default_assignee, class_name: "User", optional: true

  has_many :operation_tasks, dependent: :restrict_with_exception

  validates :title, presence: true, uniqueness: { scope: :operation_template_id }
  validates :due_offset_unit, inclusion: { in: DUE_OFFSET_UNITS }, allow_nil: true
  validates :due_offset_from, inclusion: { in: DUE_OFFSET_FROM_OPTIONS }, allow_nil: true
  validates :due_offset_value, numericality: { greater_than: 0, only_integer: true }, allow_nil: true
  validate :dependency_template_task_ids_are_valid

  scope :active, -> { where(is_active: true) }
  scope :ordered, -> { order(:position, :id) }

  before_validation :set_position, on: :create
  validate :offset_fields_are_consistent

  private

  def set_position
    self.position ||= (operation_template.operation_template_tasks.maximum(:position) || 0) + 1
  end

  def offset_fields_are_consistent
    fields = [ due_offset_value, due_offset_unit, due_offset_from ]
    return if fields.all?(&:blank?) || fields.none?(&:blank?)

    errors.add(:base, "due offset value, unit, and reference point must all be provided together")
  end

  def dependency_template_task_ids_are_valid
    return if dependency_template_task_ids.blank?

    normalized = dependency_template_task_ids.map(&:to_i).uniq
    self.dependency_template_task_ids = normalized

    if id.present? && normalized.include?(id)
      errors.add(:dependency_template_task_ids, "cannot include the task itself")
    end

    valid_ids = operation_template.operation_template_tasks.where(id: normalized).pluck(:id)
    invalid_ids = normalized - valid_ids
    errors.add(:dependency_template_task_ids, "contain invalid task references") if invalid_ids.any?
  end
end
