# frozen_string_literal: true

class Setting < ApplicationRecord
  DEFAULT_CONTACT_NOTIFICATION_EMAILS = [ "admin@aireservicesguam.com" ].freeze
  DEFAULT_CONTACT_INQUIRY_TOPICS = [
    "Private Pilot Certificate",
    "Discovery Flight",
    "Aircraft Rental",
    "Careers",
    "General Inquiry"
  ].freeze

  validates :key, presence: true, uniqueness: true

  DEFAULTS = {
    "overtime_daily_threshold_hours" => "8",
    "overtime_weekly_threshold_hours" => "40",
    "early_clock_in_buffer_minutes" => "5",
    "schedule_required_for_clock_in" => "false",
    "contact_email" => DEFAULT_CONTACT_NOTIFICATION_EMAILS.join(", "),
    "contact_inquiry_topics" => DEFAULT_CONTACT_INQUIRY_TOPICS.to_json
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

  def self.contact_notification_emails
    normalize_emails(get("contact_email"))
  end

  def self.set_contact_notification_emails!(emails)
    set(
      "contact_email",
      normalize_emails(emails).join(", "),
      description: "Comma-separated notification recipients for website contact inquiries"
    )
  end

  def self.contact_inquiry_topics
    value = get("contact_inquiry_topics")
    parse_contact_inquiry_topics(value)
  rescue JSON::ParserError
    DEFAULT_CONTACT_INQUIRY_TOPICS
  end

  def self.set_contact_inquiry_topics!(topics)
    normalized_topics = normalize_contact_inquiry_topics(topics)
    set(
      "contact_inquiry_topics",
      normalized_topics.to_json,
      description: "JSON array of inquiry topics shown on the public contact form"
    )
  end

  def self.update_contact_settings!(emails:, topics:)
    transaction do
      set_contact_notification_emails!(emails)
      set_contact_inquiry_topics!(topics)
    end
  end

  def self.normalize_emails(value)
    Array(value)
      .flat_map { |emails| emails.to_s.split(/[\n,;]+/) }
      .map(&:strip)
      .reject(&:blank?)
      .uniq
  end

  def self.normalize_contact_inquiry_topics(value)
    Array(value)
      .flat_map { |topics| topics.to_s.split(/\n+/) }
      .map(&:strip)
      .reject(&:blank?)
      .uniq
  end

  def self.parse_contact_inquiry_topics(value)
    return DEFAULT_CONTACT_INQUIRY_TOPICS if value.blank?

    parsed = JSON.parse(value)
    topics = normalize_contact_inquiry_topics(parsed)
    topics.presence || DEFAULT_CONTACT_INQUIRY_TOPICS
  end
end
