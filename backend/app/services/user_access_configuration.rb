# frozen_string_literal: true

class UserAccessConfiguration
  class ConfigurationError < StandardError; end

  EMAIL_FORMAT = /\A[^@\s]+@[^@\s]+\.[^@\s]+\z/
  ACCESS_FIELDS = %w[personal_access_enabled kiosk_enabled time_tracking_enabled].freeze

  attr_reader :generated_pin

  def initialize(user:, attributes:, actor:, creating: false)
    @user = user
    @attributes = attributes.to_h.with_indifferent_access
    @actor = actor
    @creating = creating
    @generated_pin = nil
  end

  def apply!
    configuration = resolved_configuration
    validate_configuration!(configuration)
    ensure_no_active_clock_transition!(configuration)

    previous_access = access_snapshot
    assign_identity!(configuration)
    assign_access!(configuration)
    configure_kiosk_pin!(configuration)
    save_user!
    sync_time_categories!(configuration) if configuration[:time_tracking_enabled]
    log_access_change!(previous_access)

    configuration
  end

  private

  attr_reader :user, :attributes, :actor, :creating

  def resolved_configuration
    personal_access_enabled = boolean_value(:personal_access_enabled, default: user.personal_access_enabled?)
    time_tracking_enabled = boolean_value(:time_tracking_enabled, default: user.time_tracking_enabled?)
    # Time tracking and kiosk access are one capability. Keep accepting the
    # legacy kiosk_enabled input for API compatibility, but never let it create
    # a contradictory access state.
    kiosk_enabled = time_tracking_enabled
    role = attributes[:role].presence || user.role.presence || "employee"
    email = attributes.key?(:email) ? attributes[:email].to_s.strip.downcase.presence : user.email
    first_name = attributes.key?(:first_name) ? attributes[:first_name].to_s.strip.presence : user.first_name
    last_name = attributes.key?(:last_name) ? attributes[:last_name].to_s.strip.presence : user.last_name
    category_ids = if attributes.key?(:time_category_ids)
      Array(attributes[:time_category_ids]).reject { |value| value.to_s.blank? }.map do |value|
        value_string = value.to_s
        unless value_string.match?(/\A[1-9]\d*\z/)
          raise ConfigurationError, "Work category IDs must be positive whole numbers"
        end

        value_string.to_i
      end.uniq
    else
      user.user_time_categories.pluck(:time_category_id)
    end

    {
      personal_access_enabled: personal_access_enabled,
      time_tracking_enabled: time_tracking_enabled,
      kiosk_enabled: kiosk_enabled,
      role: role,
      email: email,
      first_name: first_name,
      last_name: last_name,
      category_ids: category_ids
    }
  end

  def validate_configuration!(configuration)
    raise ConfigurationError, "Role must be admin or employee" unless %w[admin employee].include?(configuration[:role])

    if configuration[:role] == "admin" && !configuration[:personal_access_enabled]
      raise ConfigurationError, "Admins must keep personal sign-in enabled"
    end

    if configuration[:personal_access_enabled]
      raise ConfigurationError, "Email is required when personal sign-in is enabled" if configuration[:email].blank?
      raise ConfigurationError, "Invalid email format" unless configuration[:email].match?(EMAIL_FORMAT)

      duplicate = User.where.not(id: user.id).exists?([ "LOWER(email) = ?", configuration[:email] ])
      raise ConfigurationError, "A user with this email already exists" if duplicate

      if user.persisted? && user.personal_access_enabled? && !user.pending_invite? && configuration[:email] != user.email&.downcase
        raise ConfigurationError, "Activated Clerk users must update their email from Clerk"
      end
    end

    if !configuration[:personal_access_enabled] && configuration[:first_name].blank?
      raise ConfigurationError, "First name is required for kiosk-only users"
    end

    if !configuration[:personal_access_enabled] && !configuration[:time_tracking_enabled]
      raise ConfigurationError, "Kiosk-only users must track work hours"
    end

    validate_categories!(configuration) if configuration[:time_tracking_enabled]
  end

  def validate_categories!(configuration)
    category_ids = configuration[:category_ids]
    raise ConfigurationError, "Choose at least one work category for a person who tracks work hours" if category_ids.empty?

    active_category_ids = TimeCategory.active.where(id: category_ids).pluck(:id)
    return if active_category_ids.sort == category_ids.sort

    raise ConfigurationError, "Every assigned work category must be active"
  end

  def ensure_no_active_clock_transition!(configuration)
    return if creating || !access_state_changes?(configuration)
    return unless user.time_entries.where(status: %w[clocked_in on_break]).exists?

    raise ConfigurationError, "Clock this person out before changing their access or time-tracking setup"
  end

  def access_state_changes?(configuration)
    ACCESS_FIELDS.any? { |field| user.public_send("#{field}?") != configuration[field.to_sym] } ||
      category_assignment_changes?(configuration)
  end

  def category_assignment_changes?(configuration)
    return false unless attributes.key?(:time_category_ids)

    user.user_time_categories.pluck(:time_category_id).sort != configuration[:category_ids].sort
  end

  def assign_identity!(configuration)
    user.role = configuration[:role]
    user.email = configuration[:email]
    user.personal_access_enabled = configuration[:personal_access_enabled]

    if configuration[:personal_access_enabled]
      if creating
        user.profile_source = "local"
        user.first_name = nil
        user.last_name = nil
      elsif !user.personal_access_enabled_was
        user.profile_source = user.pending_invite? ? "local" : "clerk"
      end
    else
      user.profile_source = "local"
      user.first_name = configuration[:first_name]
      user.last_name = configuration[:last_name]
    end
  end

  def assign_access!(configuration)
    user.time_tracking_enabled = configuration[:time_tracking_enabled]
    user.kiosk_enabled = configuration[:kiosk_enabled]

    return if configuration[:kiosk_enabled]

    user.kiosk_pin = nil
    user.kiosk_pin_digest = nil
    user.kiosk_pin_lookup_hash = nil
    user.kiosk_pin_last_rotated_at = nil
    user.kiosk_failed_attempts_count = 0
    user.kiosk_locked_until = nil
  end

  def configure_kiosk_pin!(configuration)
    return unless configuration[:kiosk_enabled]

    requested_pin = attributes[:kiosk_pin].to_s.strip.presence
    return if requested_pin.blank? && user.kiosk_pin_configured?

    # Personal accounts choose their own PIN in a blocking first-sign-in flow.
    # Kiosk-only staff cannot sign in to complete that flow, so the admin gets
    # a one-time generated PIN when one was not supplied.
    return if requested_pin.blank? && configuration[:personal_access_enabled]

    @generated_pin = requested_pin || format("%06d", SecureRandom.random_number(1_000_000))
    user.kiosk_pin = generated_pin
    user.kiosk_pin_last_rotated_at = Time.current
    user.kiosk_failed_attempts_count = 0
    user.kiosk_locked_until = nil
  end

  def sync_time_categories!(configuration)
    desired_ids = configuration[:category_ids]
    overrides = attributes[:time_category_rate_overrides] || {}

    user.user_time_categories.where.not(time_category_id: desired_ids).destroy_all
    desired_ids.each do |category_id|
      assignment = user.user_time_categories.find_or_initialize_by(time_category_id: category_id)
      override = overrides[category_id.to_s]
      assignment.hourly_rate_cents = override.to_i if override.present?
      assignment.save!
    end
  end

  def save_user!
    user.save!
  rescue ActiveRecord::RecordNotUnique => e
    raise unless e.message.include?("index_users_on_lower_email")

    raise ConfigurationError, "A user with this email already exists"
  end

  def log_access_change!(previous_access)
    current_access = access_snapshot
    access_changes = current_access.each_with_object({}) do |(key, value), result|
      previous = previous_access[key]
      result[key] = [ previous, value ] if previous != value
    end
    snapshot = AuditRecordSnapshot.changes_for(user)
    model_changes = snapshot[:changed_fields].each_with_object({}) do |field, result|
      result[field] = [ snapshot[:before_values][field], snapshot[:after_values][field] ]
    end
    changes = model_changes.merge(access_changes)
    return if changes.empty?

    AuditLog.record!(
      auditable: user,
      action: creating ? "user.created" : "user.updated",
      actor: actor,
      event_category: "users",
      changes: changes,
      metadata: {
        reason: "staff access configuration",
        redacted_fields: snapshot[:redacted_fields].presence
      }.compact
    )
  end

  def access_snapshot
    {
      "personal_access_enabled" => user.personal_access_enabled?,
      "kiosk_enabled" => user.kiosk_enabled?,
      "time_tracking_enabled" => user.time_tracking_enabled?,
      "profile_source" => user.profile_source,
      "time_category_ids" => user.persisted? ? user.user_time_categories.pluck(:time_category_id).sort : []
    }
  end

  def boolean_value(key, default:)
    return default unless attributes.key?(key)

    ActiveModel::Type::Boolean.new.cast(attributes[key])
  end
end
