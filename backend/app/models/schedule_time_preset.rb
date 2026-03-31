# frozen_string_literal: true

class ScheduleTimePreset < ApplicationRecord
  # Validations
  validates :label, presence: true
  validates :start_time, presence: true
  validates :end_time, presence: true
  validates :position, presence: true, numericality: { only_integer: true, greater_than_or_equal_to: 0 }
  validate :end_time_after_start_time

  # Scopes
  scope :active, -> { where(active: true) }
  scope :ordered, -> { order(:position) }

  # Callbacks
  before_validation :set_position, on: :create

  # Format times for display
  def formatted_start_time
    start_time&.strftime("%-I:%M %p")
  end

  def formatted_end_time
    end_time&.strftime("%-I:%M %p")
  end

  # Format for schedule form (24h format)
  def start_time_value
    start_time&.strftime("%H:%M")
  end

  def end_time_value
    end_time&.strftime("%H:%M")
  end

  private

  def end_time_after_start_time
    return unless start_time && end_time

    if end_time <= start_time
      errors.add(:end_time, "must be after start time")
    end
  end

  def set_position
    self.position ||= (ScheduleTimePreset.maximum(:position) || -1) + 1
  end
end
