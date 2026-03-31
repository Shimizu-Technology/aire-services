# frozen_string_literal: true

class Schedule < ApplicationRecord
  belongs_to :user, optional: true
  belongs_to :created_by, class_name: "User", optional: true
  has_many :time_entries, dependent: :nullify

  validates :work_date, presence: true
  validates :start_time, presence: true
  validates :end_time, presence: true
  validate :end_time_after_start_time

  scope :for_date, ->(date) { where(work_date: date) }
  scope :for_date_range, ->(start_date, end_date) { where(work_date: start_date..end_date) }
  scope :for_user, ->(user_id) { where(user_id: user_id) }
  scope :ordered, -> { order(:work_date, :start_time) }
  scope :upcoming, -> { where("work_date >= ?", Date.current).ordered }

  # Calculate hours for this shift
  def hours
    return 0 unless start_time && end_time
    
    start_seconds = start_time.utc.seconds_since_midnight
    end_seconds = end_time.utc.seconds_since_midnight
    
    ((end_seconds - start_seconds) / 3600.0).round(2)
  end

  def formatted_start_time
    start_time&.utc&.strftime("%-I:%M %p")
  end

  def formatted_end_time
    end_time&.utc&.strftime("%-I:%M %p")
  end

  # Format as range (e.g., "8:30 AM - 5:00 PM")
  def formatted_time_range
    "#{formatted_start_time} - #{formatted_end_time}"
  end

  private

  def end_time_after_start_time
    return unless start_time && end_time
    
    if end_time.utc <= start_time.utc
      errors.add(:end_time, "must be after start time")
    end
  end
end
