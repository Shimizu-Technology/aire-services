# frozen_string_literal: true

class LeaveRequest < ApplicationRecord
  LEAVE_TYPES = %w[paid_time_off sick unpaid bereavement other].freeze
  STATUSES = %w[pending approved declined cancelled].freeze

  belongs_to :user
  belongs_to :reviewed_by, class_name: "User", optional: true
  belongs_to :cancelled_by, class_name: "User", optional: true

  validates :leave_type, presence: true, inclusion: { in: LEAVE_TYPES }
  validates :status, presence: true, inclusion: { in: STATUSES }
  validates :start_date, presence: true
  validates :end_date, presence: true
  validate :end_date_on_or_after_start_date
  validate :does_not_overlap_active_request, if: :requires_overlap_validation?

  scope :pending_review, -> { where(status: "pending") }
  scope :recent, -> { order(start_date: :desc, created_at: :desc) }

  def pending?
    status == "pending"
  end

  def reviewable_by?(acting_user)
    pending? && acting_user.admin? && user_id != acting_user.id
  end

  def cancelable_by?(acting_user)
    pending? && user_id == acting_user.id
  end

  def total_days
    return 0 unless start_date.present? && end_date.present?

    (end_date - start_date).to_i + 1
  end

  private

  def requires_overlap_validation?
    return false if user_id.blank? || start_date.blank? || end_date.blank?
    return false unless status.in?(%w[pending approved])

    return true if new_record?
    return true if will_save_change_to_user_id? || will_save_change_to_start_date? || will_save_change_to_end_date?

    !status_in_database.in?(%w[pending approved])
  end

  def end_date_on_or_after_start_date
    return if start_date.blank? || end_date.blank?
    return if end_date >= start_date

    errors.add(:end_date, "must be on or after the start date")
  end

  def does_not_overlap_active_request
    return if user_id.blank? || start_date.blank? || end_date.blank?

    overlapping = if user.present?
      user.with_lock { overlapping_active_requests.exists? }
    else
      overlapping_active_requests.exists?
    end

    return unless overlapping

    errors.add(:base, "overlaps with another pending or approved leave request")
  end

  def overlapping_active_requests
    self.class
      .where(user_id: user_id, status: %w[pending approved])
      .where.not(id: id)
      .where("start_date <= ? AND end_date >= ?", end_date, start_date)
  end
end
