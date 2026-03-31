# frozen_string_literal: true

class TimeEntryBreak < ApplicationRecord
  belongs_to :time_entry

  validates :start_time, presence: true
  validate :end_time_after_start_time, if: -> { end_time.present? }

  before_save :calculate_duration, if: -> { end_time.present? && end_time_changed? }

  scope :active, -> { where(end_time: nil) }
  scope :completed, -> { where.not(end_time: nil) }

  def active?
    end_time.nil?
  end

  def close!(end_at = Time.current)
    update!(end_time: end_at)
  end

  private

  def calculate_duration
    self.duration_minutes = ((end_time - start_time) / 60).round
  end

  def end_time_after_start_time
    if end_time <= start_time
      errors.add(:end_time, "must be after start time")
    end
  end
end
