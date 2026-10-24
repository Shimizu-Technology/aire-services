# frozen_string_literal: true

class TimeEntryBreak < ApplicationRecord
  around_save :recompute_affected_overtime
  around_destroy :recompute_affected_overtime
  belongs_to :time_entry

  validates :start_time, presence: true
  validate :end_time_after_start_time, if: -> { end_time.present? }

  before_save :calculate_duration, if: -> { end_time.present? && (start_time_changed? || end_time_changed?) }

  scope :active, -> { where(end_time: nil) }
  scope :completed, -> { where.not(end_time: nil) }

  def active?
    end_time.nil?
  end

  def close!(end_at = Time.current)
    update!(end_time: end_at)
  end

  private

  def recompute_affected_overtime(&block)
    source = time_entry
    Payroll::AffectedOvertimeReview.around(source, force: true) do
      result = block.call
      # The DB break trigger advances the source version even when no scalar
      # minutes changed. Keep the owning in-memory record usable in its outer
      # clock/correction transaction without reloading its unsaved fields.
      version = TimeEntry.where(id: source.id).pick(:lock_version)
      source.lock_version = version if version
      source.send(:clear_attribute_change, "lock_version")
      result
    end
  end

  def calculate_duration
    self.duration_minutes = ((end_time - start_time) / 60).round
  end

  def end_time_after_start_time
    if end_time <= start_time
      errors.add(:end_time, "must be after start time")
    end
  end
end
