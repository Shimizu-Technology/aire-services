# frozen_string_literal: true

class DailyTask < ApplicationRecord
  STATUSES = %w[
    not_started
    in_progress
    dms_reviewing
    ready_to_file
    ready_for_signature
    completed
    filed_with_drt
    filed_with_irs
    pending_info
    other
    done
  ].freeze
  PRIORITIES = %w[low normal high urgent].freeze

  belongs_to :client, optional: true
  belongs_to :tax_return, optional: true
  belongs_to :service_type, optional: true
  belongs_to :assigned_to, class_name: "User", optional: true
  belongs_to :reviewed_by, class_name: "User", optional: true
  belongs_to :created_by, class_name: "User", optional: true
  belongs_to :status_changed_by, class_name: "User", optional: true
  belongs_to :completed_by, class_name: "User", optional: true

  validates :title, presence: true
  validates :task_date, presence: true
  validates :status, presence: true, inclusion: { in: STATUSES }
  validates :priority, presence: true, inclusion: { in: PRIORITIES }

  DONE_STATUSES = %w[completed filed_with_drt filed_with_irs done].freeze

  scope :for_date, ->(date) { where(task_date: date) }
  scope :ordered, -> { order(position: :asc, created_at: :asc) }
  scope :pending, -> { where(status: "not_started") }
  scope :in_progress, -> { where.not(status: %w[not_started] + DONE_STATUSES) }
  scope :completed, -> { where(status: DONE_STATUSES) }
  scope :not_done, -> { where.not(status: DONE_STATUSES) }
  scope :for_user, ->(user_id) { where(assigned_to_id: user_id) }
  scope :overdue, -> { not_done.where("due_date < ?", Date.current) }
end
