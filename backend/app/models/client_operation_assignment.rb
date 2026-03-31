# frozen_string_literal: true

class ClientOperationAssignment < ApplicationRecord
  ASSIGNMENT_STATUSES = %w[active paused].freeze

  belongs_to :client
  belongs_to :operation_template
  belongs_to :created_by, class_name: "User", optional: true

  has_many :operation_cycles, dependent: :nullify

  validates :assignment_status, inclusion: { in: ASSIGNMENT_STATUSES }
  validates :operation_template_id, uniqueness: { scope: :client_id }
  validate :date_range_is_valid
  validate :excluded_template_tasks_belong_to_template, if: :should_validate_excluded_template_tasks?

  scope :active, -> { where(assignment_status: "active") }
  scope :paused, -> { where(assignment_status: "paused") }

  private

  def date_range_is_valid
    return if starts_on.blank? || ends_on.blank? || ends_on >= starts_on

    errors.add(:ends_on, "must be on or after start date")
  end

  def excluded_template_tasks_belong_to_template
    ids = Array(excluded_template_task_ids).map(&:to_i).uniq
    self.excluded_template_task_ids = ids
    return if ids.empty? || operation_template.blank?

    valid_ids = operation_template.operation_template_tasks.where(id: ids).pluck(:id)
    invalid_ids = ids - valid_ids
    return if invalid_ids.empty?

    errors.add(:excluded_template_task_ids, "contain invalid template tasks")
  end

  def should_validate_excluded_template_tasks?
    will_save_change_to_excluded_template_task_ids? || new_record?
  end
end
