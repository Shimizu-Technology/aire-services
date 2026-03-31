# frozen_string_literal: true

class Setting < ApplicationRecord
  validates :key, presence: true, uniqueness: true

  # Default values for settings
  DEFAULTS = {
    "contact_email" => "dmshimizucpa@gmail.com",
    "notification_email" => "dmshimizucpa@gmail.com",
    "overtime_daily_threshold_hours" => "8",
    "overtime_weekly_threshold_hours" => "40",
    "early_clock_in_buffer_minutes" => "5"
  }.freeze

  # Get a setting value (with default fallback)
  def self.get(key)
    setting = find_by(key: key)
    setting&.value || DEFAULTS[key.to_s]
  end

  # Set a setting value
  def self.set(key, value, description: nil)
    setting = find_or_initialize_by(key: key)
    setting.value = value
    setting.description = description if description.present?
    setting.save!
    setting
  end

  # Get all settings as a hash
  def self.all_as_hash
    settings = all.index_by(&:key)
    DEFAULTS.merge(settings.transform_values(&:value))
  end
end
