# frozen_string_literal: true

class TaxReturn < ApplicationRecord
  belongs_to :client
  belongs_to :workflow_stage, optional: true
  belongs_to :assigned_to, class_name: "User", optional: true
  belongs_to :reviewed_by, class_name: "User", optional: true

  has_many :income_sources, dependent: :destroy
  has_many :workflow_events, dependent: :destroy
  has_many :documents, dependent: :destroy
  has_many :time_entries, dependent: :nullify
  has_many :transmittals, dependent: :nullify
  has_many :notifications, dependent: :destroy

  validates :tax_year, presence: true, numericality: { only_integer: true }
  validates :client_id, uniqueness: { scope: :tax_year, message: "already has a return for this tax year" }

  scope :for_year, ->(year) { where(tax_year: year) }
  scope :current_year, -> { for_year(Date.current.year) }

  # Store current user for audit logging (set by controller)
  attr_accessor :current_actor

  after_save :log_status_change, if: :saved_change_to_workflow_stage_id?
  after_save :log_assignment_change, if: :saved_change_to_assigned_to_id?
  after_save :log_notes_change, if: :saved_change_to_notes?
  after_commit :send_status_notification, on: :update, if: :saved_change_to_workflow_stage_id?

  def status_name
    workflow_stage&.name || "Unknown"
  end

  private

  def log_status_change
    old_stage = WorkflowStage.find_by(id: workflow_stage_id_before_last_save)
    workflow_events.create!(
      event_type: "status_changed",
      old_value: old_stage&.name,
      new_value: workflow_stage&.name,
      description: "Status changed from #{old_stage&.name || 'none'} to #{workflow_stage&.name}",
      user: current_actor
    )
  end

  def send_status_notification
    StatusNotificationJob.perform_later(id, workflow_stage_id)
  rescue StandardError => e
    Rails.logger.error "Failed to enqueue notification for tax return #{id}: #{e.message}"
  end

  def log_assignment_change
    old_user = User.find_by(id: assigned_to_id_before_last_save)
    workflow_events.create!(
      event_type: "assigned",
      old_value: old_user&.full_name,
      new_value: assigned_to&.full_name,
      description: "Assigned to #{assigned_to&.full_name || 'unassigned'}",
      user: current_actor
    )
  end

  def log_notes_change
    workflow_events.create!(
      event_type: "note_added",
      old_value: notes_before_last_save,
      new_value: notes,
      description: "Notes updated",
      user: current_actor
    )
  end
end
