# frozen_string_literal: true

class OperationTask < ApplicationRecord
  STATUSES = %w[not_started in_progress blocked done].freeze

  belongs_to :operation_cycle, inverse_of: :operation_tasks
  belongs_to :operation_template_task
  belongs_to :client
  belongs_to :assigned_to, class_name: "User", optional: true
  belongs_to :completed_by, class_name: "User", optional: true
  belongs_to :linked_time_entry, class_name: "TimeEntry", optional: true

  validates :title, presence: true
  validates :status, inclusion: { in: STATUSES }
  validate :evidence_is_present_when_required
  validate :prerequisites_must_be_done_for_forward_progress

  scope :ordered, -> { order(:position, :id) }
  scope :for_assignee, ->(user_id) { where(assigned_to_id: user_id) }
  scope :overdue, -> { where("due_at IS NOT NULL AND due_at < ? AND status != ?", Time.current, "done") }
  scope :blocked, -> { where(status: "blocked") }
  scope :active, -> { where.not(status: "done") }

  before_save :set_started_at_when_work_begins

  def done?
    status == "done"
  end

  def prerequisite_tasks
    dependency_ids = operation_template_task&.dependency_template_task_ids || []
    return OperationTask.none if dependency_ids.empty? || operation_cycle_id.blank?

    if operation_cycle&.association(:operation_tasks)&.loaded?
      return operation_cycle.operation_tasks
                            .select { |task| dependency_ids.include?(task.operation_template_task_id) }
                            .sort_by { |task| [ task.position, task.id ] }
    end

    OperationTask.where(operation_cycle_id: operation_cycle_id, operation_template_task_id: dependency_ids).ordered
  end

  def unmet_prerequisite_tasks
    tasks = prerequisite_tasks
    return tasks.reject(&:done?) if tasks.is_a?(Array)

    tasks.where.not(status: "done")
  end

  private

  def evidence_is_present_when_required
    return unless evidence_required && done? && evidence_note.blank?

    errors.add(:evidence_note, "is required to complete this task")
  end

  def set_started_at_when_work_begins
    return unless will_save_change_to_status? && status == "in_progress" && started_at.blank?

    self.started_at = Time.current
  end

  def prerequisites_must_be_done_for_forward_progress
    return unless status.in?(%w[in_progress done])
    return if unmet_prerequisite_tasks.none?

    errors.add(:status, "cannot be updated until prerequisites are completed")
  end
end
