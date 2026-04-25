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
  DEFAULT_APPROVAL_GROUPS = [
    { "key" => "cfi", "label" => "CFI" },
    { "key" => "ops_maintenance", "label" => "Ops / Maintenance" }
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

  def self.approval_groups
    value = get("approval_groups")
    parse_approval_groups(value)
  end

  def self.approval_group_keys
    approval_groups.map { |group| group.fetch("key") }
  end

  def self.approval_group_label_for(key)
    return "Unassigned" if key.blank?

    approval_groups.find { |group| group["key"] == key.to_s }&.fetch("label", nil) || key.to_s.humanize
  end

  def self.set_approval_groups!(groups)
    normalized_groups = normalize_approval_groups(groups)
    set(
      "approval_groups",
      normalized_groups.to_json,
      description: "JSON array of approval routing groups used for pending review filters"
    )
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

  def self.normalize_approval_groups(value)
    groups = Array(value).filter_map do |group|
      raw_group = group.respond_to?(:to_h) ? group.to_h : {}
      label = raw_group["label"] || raw_group[:label] || group
      next if label.blank?

      raw_key = raw_group["key"] || raw_group[:key] || label
      key = normalize_approval_group_key(raw_key)
      raise ArgumentError, "Approval group keys may only contain letters, numbers, and underscores" if key.blank?

      { "key" => key, "label" => label.to_s.strip }
    end

    raise ArgumentError, "At least one approval group is required" if groups.empty?

    duplicate_keys = groups.group_by { |group| group["key"] }.select { |_key, rows| rows.size > 1 }.keys
    raise ArgumentError, "Approval group keys must be unique" if duplicate_keys.any?

    groups
  end

  def self.normalize_approval_group_key(value)
    value
      .to_s
      .strip
      .downcase
      .gsub(/[^a-z0-9]+/, "_")
      .gsub(/\A_+|_+\z/, "")
      .gsub(/_+/, "_")
  end

  def self.parse_contact_inquiry_topics(value)
    return DEFAULT_CONTACT_INQUIRY_TOPICS if value.blank?

    parsed = JSON.parse(value)
    topics = normalize_contact_inquiry_topics(parsed)
    topics.presence || DEFAULT_CONTACT_INQUIRY_TOPICS
  end

  def self.parse_approval_groups(value)
    return DEFAULT_APPROVAL_GROUPS.map(&:dup) if value.blank?

    parsed = JSON.parse(value)
    normalize_approval_groups(parsed)
  rescue JSON::ParserError, ArgumentError
    DEFAULT_APPROVAL_GROUPS.map(&:dup)
  end
end
