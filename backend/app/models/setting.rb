# frozen_string_literal: true

class Setting < ApplicationRecord
  validates :key, presence: true, uniqueness: true

  DEFAULTS = {
    "overtime_daily_threshold_hours" => "8",
    "overtime_weekly_threshold_hours" => "40",
    "early_clock_in_buffer_minutes" => "5",
    "schedule_required_for_clock_in" => "false"
  }.freeze

  def self.get(key)
    cached = request_cache
    if cached
      cached[key.to_s] || DEFAULTS[key.to_s]
    else
      setting = find_by(key: key)
      setting&.value || DEFAULTS[key.to_s]
    end
  end

  def self.preload_cache!
    hash = DEFAULTS.dup
    all.each { |s| hash[s.key] = s.value }
    Thread.current[:settings_cache] = hash
  end

  def self.clear_cache!
    Thread.current[:settings_cache] = nil
  end

  def self.request_cache
    Thread.current[:settings_cache]
  end

  def self.set(key, value, description: nil)
    setting = find_or_initialize_by(key: key)
    setting.value = value
    setting.description = description if description.present?
    setting.save!
    clear_cache!
    setting
  end

  def self.all_as_hash
    settings = all.index_by(&:key)
    DEFAULTS.merge(settings.transform_values(&:value))
  end
end
