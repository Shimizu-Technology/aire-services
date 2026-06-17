# frozen_string_literal: true

class Setting < ApplicationRecord
  APPROVAL_GROUPS_ADVISORY_LOCK_KEY = 92_144_007
  DEFAULT_CONTACT_NOTIFICATION_EMAILS = [ "admin@aireservicesguam.com" ].freeze
  PUBLIC_PHONE_CONTACT_CHANNELS = %w[phone whatsapp].freeze
  DEFAULT_PUBLIC_PHONE_CONTACTS = [
    {
      "label" => "Tours, flight training & payments",
      "phone_display" => "(671) 477-4243",
      "phone_e164" => "+16714774243",
      "channel" => "phone"
    },
    {
      "label" => "Admin, management & business operations",
      "phone_display" => "(671) 922-2243",
      "phone_e164" => "+16719222243",
      "channel" => "phone"
    },
    {
      "label" => "WhatsApp contact",
      "phone_display" => "(671) 997-4243",
      "phone_e164" => "+16719974243",
      "channel" => "whatsapp"
    }
  ].freeze
  DEFAULT_PUBLIC_CONTACT_SETTINGS = {
    "phone_display" => "(671) 477-4243",
    "phone_e164" => "+16714774243",
    "email" => "admin@aireservicesguam.com",
    "street_address" => "353 Admiral Sherman Boulevard",
    "address_area_label" => "Tiyan / Barrigada",
    "address_locality" => "Barrigada",
    "address_region" => "Guam",
    "postal_code" => "96913",
    "address_country" => "GU",
    "phone_contacts" => DEFAULT_PUBLIC_PHONE_CONTACTS
  }.freeze
  DEFAULT_CONTACT_INQUIRY_TOPICS = [
    "Private Pilot Certificate",
    "Aerial Tours",
    "Aircraft Rental",
    "Careers",
    "General Inquiry"
  ].freeze
  DEFAULT_PUBLIC_SOCIAL_LINKS = [
    { "key" => "instagram", "label" => "Instagram", "url" => "https://www.instagram.com/aire.services/" },
    { "key" => "facebook", "label" => "Facebook", "url" => "https://www.facebook.com/AireServicesGuam/" }
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
    "clock_in_location_enforced" => "false",
    "clock_in_location_name" => "AIRE Services Guam",
    "clock_in_location_latitude" => "13.46913",
    "clock_in_location_longitude" => "144.79901",
    "clock_in_location_radius_meters" => "1000",
    "contact_email" => DEFAULT_CONTACT_NOTIFICATION_EMAILS.join(", "),
    "contact_inquiry_topics" => DEFAULT_CONTACT_INQUIRY_TOPICS.to_json,
    "public_contact_settings" => DEFAULT_PUBLIC_CONTACT_SETTINGS.to_json,
    "public_social_links" => DEFAULT_PUBLIC_SOCIAL_LINKS.to_json
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

  def self.public_contact_settings
    value = get("public_contact_settings")
    parse_public_contact_settings(value)
  end

  def self.public_social_links
    value = get("public_social_links")
    parse_public_social_links(value)
  end

  def self.approval_groups
    value = get("approval_groups")
    parse_approval_groups(value)
  end

  def self.clock_in_location_policy
    latitude = safe_float(get("clock_in_location_latitude"))
    longitude = safe_float(get("clock_in_location_longitude"))
    radius_meters = get("clock_in_location_radius_meters").to_i
    configured = latitude.present? && longitude.present? && radius_meters.positive?

    {
      enabled: get("clock_in_location_enforced") == "true" && configured,
      configured: configured,
      name: get("clock_in_location_name").presence || "AIRE Services Guam",
      latitude: latitude,
      longitude: longitude,
      radius_meters: radius_meters
    }
  end

  def self.approval_group_keys
    approval_groups.map { |group| group.fetch("key") }
  end

  def self.approval_group_label_for(key)
    return "Unassigned" if key.blank?

    approval_groups.find { |group| group["key"] == key.to_s }&.fetch("label", nil) || key.to_s.humanize
  end

  def self.with_approval_groups_lock
    raise "Approval group lock requires an open transaction" unless connection.transaction_open?

    connection.select_value("SELECT pg_advisory_xact_lock(#{APPROVAL_GROUPS_ADVISORY_LOCK_KEY})")
    clear_cache!
    yield
  ensure
    clear_cache!
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

  def self.set_public_contact_settings!(settings)
    normalized_settings = normalize_public_contact_settings(settings)
    set(
      "public_contact_settings",
      normalized_settings.to_json,
      description: "JSON object of public phone directory, email, and address shown on the marketing website"
    )
  end

  def self.set_public_social_links!(links)
    normalized_links = normalize_public_social_links(links)
    set(
      "public_social_links",
      normalized_links.to_json,
      description: "JSON array of public social media links shown on the marketing website"
    )
  end

  def self.update_contact_settings!(emails:, topics:, public_contact:, social_links:)
    transaction do
      set_contact_notification_emails!(emails)
      set_contact_inquiry_topics!(topics)
      set_public_contact_settings!(public_contact)
      set_public_social_links!(social_links)
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

  def self.default_public_phone_contacts
    DEFAULT_PUBLIC_PHONE_CONTACTS.map(&:dup)
  end

  def self.default_public_contact_settings
    DEFAULT_PUBLIC_CONTACT_SETTINGS
      .except("phone_contacts")
      .merge("phone_contacts" => default_public_phone_contacts)
  end

  def self.normalize_public_contact_settings(value)
    raw = value.respond_to?(:to_h) ? value.to_h : {}
    string_defaults = DEFAULT_PUBLIC_CONTACT_SETTINGS.except("phone_contacts")

    normalized = string_defaults.keys.index_with do |key|
      raw[key].presence || raw[key.to_sym].presence || string_defaults.fetch(key)
    end.transform_values { |setting| setting.to_s.strip }

    raw_phone_contacts = raw.key?("phone_contacts") ? raw["phone_contacts"] : raw[:phone_contacts]
    normalized["phone_contacts"] = normalize_public_phone_contacts(raw_phone_contacts.presence || default_public_phone_contacts)
    normalized
  end

  def self.normalize_public_phone_contacts(value)
    contacts = Array(value).filter_map do |contact|
      raw_contact = contact.respond_to?(:to_h) ? contact.to_h : {}
      label = raw_contact["label"].presence || raw_contact[:label].presence
      phone_display = raw_contact["phone_display"].presence || raw_contact[:phone_display].presence
      phone_e164 = raw_contact["phone_e164"].presence || raw_contact[:phone_e164].presence
      channel = (raw_contact["channel"].presence || raw_contact[:channel].presence || "phone").to_s.strip.downcase

      next if label.blank? && phone_display.blank? && phone_e164.blank?

      if label.blank? || phone_display.blank? || phone_e164.blank?
        raise ArgumentError, "Each public phone contact needs a label, display number, and link number"
      end

      unless PUBLIC_PHONE_CONTACT_CHANNELS.include?(channel)
        raise ArgumentError, "Public phone contact channel must be phone or WhatsApp"
      end

      phone_e164 = phone_e164.to_s.strip
      unless valid_e164_phone?(phone_e164)
        raise ArgumentError, "Public phone contact link numbers must use E.164 format, such as +16714774243"
      end

      {
        "label" => label.to_s.strip,
        "phone_display" => phone_display.to_s.strip,
        "phone_e164" => phone_e164,
        "channel" => channel
      }
    end

    return default_public_phone_contacts if contacts.empty?

    duplicate_numbers = contacts.group_by { |contact| contact["phone_e164"] }.select { |_phone, rows| rows.size > 1 }.keys
    raise ArgumentError, "Public phone contact link numbers must be unique" if duplicate_numbers.any?

    contacts
  end

  def self.normalize_public_social_links(value)
    links = Array(value).filter_map do |link|
      raw_link = link.respond_to?(:to_h) ? link.to_h : {}
      label = raw_link["label"].presence || raw_link[:label].presence
      url = raw_link["url"].presence || raw_link[:url].presence
      next if label.blank? && url.blank?
      raise ArgumentError, "Each social link needs a label and URL" if label.blank? || url.blank?

      url = url.to_s.strip
      raise ArgumentError, "Social link URLs must start with http:// or https://" unless valid_public_social_url?(url)

      raw_key = raw_link["key"].presence || raw_link[:key].presence || label
      key = normalize_approval_group_key(raw_key)
      raise ArgumentError, "Social link keys may only contain letters, numbers, and underscores" if key.blank?

      { "key" => key, "label" => label.to_s.strip, "url" => url }
    end

    duplicate_keys = links.group_by { |link| link["key"] }.select { |_key, rows| rows.size > 1 }.keys
    raise ArgumentError, "Social link keys must be unique" if duplicate_keys.any?

    links
  end

  def self.normalize_approval_groups(value)
    groups = Array(value).filter_map do |group|
      raw_group = group.respond_to?(:to_h) ? group.to_h : {}
      label = raw_group["label"].presence || raw_group[:label].presence || group
      next if label.blank?

      raw_key = raw_group["key"].presence || raw_group[:key].presence || label
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

  def self.parse_public_contact_settings(value)
    return default_public_contact_settings if value.blank?

    parsed = JSON.parse(value)
    normalize_public_contact_settings(parsed)
  rescue JSON::ParserError, ArgumentError
    default_public_contact_settings
  end

  def self.parse_public_social_links(value)
    return DEFAULT_PUBLIC_SOCIAL_LINKS.map(&:dup) if value.blank?

    parsed = JSON.parse(value)
    normalize_public_social_links(parsed)
  rescue JSON::ParserError, ArgumentError
    DEFAULT_PUBLIC_SOCIAL_LINKS.map(&:dup)
  end

  def self.parse_approval_groups(value)
    return DEFAULT_APPROVAL_GROUPS.map(&:dup) if value.blank?

    parsed = JSON.parse(value)
    normalize_approval_groups(parsed)
  rescue JSON::ParserError, ArgumentError
    DEFAULT_APPROVAL_GROUPS.map(&:dup)
  end

  def self.valid_public_social_url?(value)
    uri = URI.parse(value)
    uri.is_a?(URI::HTTP) && uri.host.present?
  rescue URI::InvalidURIError
    false
  end

  def self.valid_e164_phone?(value)
    value.to_s.match?(/\A\+[1-9]\d{7,14}\z/)
  end

  def self.safe_float(value)
    Float(value)
  rescue ArgumentError, TypeError
    nil
  end
end
