# frozen_string_literal: true

class LeaveRequest < ApplicationRecord
  LEAVE_TYPES = %w[paid_time_off sick unpaid bereavement other].freeze
  STATUSES = %w[pending approved declined cancelled].freeze

  belongs_to :user
  belongs_to :reviewed_by, class_name: "User", optional: true

  validates :leave_type, presence: true, inclusion: { in: LEAVE_TYPES }
  validates :status, presence: true, inclusion: { in: STATUSES }
  validates :start_date, presence: true
  validates :end_date, presence: true
  validate :end_date_on_or_after_start_date

  scope :pending_review, -> { where(status: "pending") }
  scope :recent, -> { order(start_date: :desc, created_at: :desc) }

  def pending?
    status == "pending"
  end

  def reviewable_by?(acting_user)
    pending? && acting_user.admin?
  end

  def cancelable_by?(acting_user)
    pending? && user_id == acting_user.id
  end

  def total_days
    return 0 unless start_date.present? && end_date.present?

    (end_date - start_date).to_i + 1
  end

  private

  def end_date_on_or_after_start_date
    return if start_date.blank? || end_date.blank?
    return if end_date >= start_date

    errors.add(:end_date, "must be on or after the start date")
  end
end
