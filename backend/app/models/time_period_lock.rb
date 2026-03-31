# frozen_string_literal: true

class TimePeriodLock < ApplicationRecord
  belongs_to :locked_by, class_name: "User"

  validates :start_date, :end_date, :locked_at, presence: true
  validate :end_date_on_or_after_start_date

  scope :covering_date, ->(date) { where("start_date <= ? AND end_date >= ?", date, date) }
  scope :recent, -> { order(start_date: :desc) }

  def self.week_bounds_for(date)
    d = date.to_date
    week_start = d.beginning_of_week(:sunday)
    week_end = week_start + 6.days
    [week_start, week_end]
  end

  def self.locked_for_date?(date)
    covering_date(date.to_date).exists?
  end

  private

  def end_date_on_or_after_start_date
    return if end_date.blank? || start_date.blank?
    return if end_date >= start_date

    errors.add(:end_date, "must be on or after start date")
  end
end
