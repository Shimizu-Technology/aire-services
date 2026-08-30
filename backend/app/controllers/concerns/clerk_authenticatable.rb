# frozen_string_literal: true

require "digest"

# Concern for Clerk JWT authentication
# Include in controllers that require authentication
module ClerkAuthenticatable
  extend ActiveSupport::Concern

  INVITE_ONLY_MESSAGE = "Access denied. You haven't been invited to this system. Please contact an administrator.".freeze

  private

  def authenticate_user!
    header = request.headers["Authorization"]

    unless header.present?
      AuditLog.record_security_event!(action: "auth.sign_in_failed", outcome: "failed", metadata: { reason: "missing_authorization_header" })
      render_unauthorized("Missing authorization header")
      return
    end

    token = header.split(" ").last
    decoded = ClerkAuth.verify(token)

    unless decoded
      AuditLog.record_security_event!(action: "auth.sign_in_failed", outcome: "failed", metadata: { reason: "invalid_or_expired_token" })
      render_unauthorized("Invalid or expired token")
      return
    end

    set_session_fingerprint(decoded)

    @current_user = resolve_user_from_claims(decoded)

    unless @current_user
      AuditLog.record_security_event!(action: "auth.access_denied", outcome: "denied", metadata: { reason: "not_invited" })
      render_forbidden(INVITE_ONLY_MESSAGE)
      return # rubocop:disable Style/RedundantReturn -- consistent with other early-exits in this method
    end

    unless @current_user.personal_access_enabled?
      Current.user = @current_user
      AuditLog.record_security_event!(action: "auth.access_denied", actor: @current_user, outcome: "denied", metadata: { reason: "personal_access_disabled" })
      render_forbidden("Personal sign-in is disabled for this staff record. Use the shared kiosk or contact an administrator.")
      return
    end

    unless @current_user.is_active?
      Current.user = @current_user
      AuditLog.record_security_event!(action: "auth.access_denied", actor: @current_user, outcome: "denied", metadata: { reason: "inactive_user" })
      render_forbidden("Your access has been deactivated. Please contact an administrator.")
      return
    end


    Current.user = @current_user
  end

  def authenticate_user_optional
    header = request.headers["Authorization"]
    return unless header.present?

    token = header.split(" ").last
    decoded = ClerkAuth.verify(token)
    return unless decoded

    set_session_fingerprint(decoded)

    resolved_user = resolve_user_from_claims(decoded)
    if resolved_user&.is_active? && resolved_user.personal_access_enabled?
      @current_user = resolved_user
      Current.user = resolved_user
    end
  end

  def current_user
    @current_user
  end

  def require_admin!
    authenticate_user! unless @current_user
    return if performed?

    unless @current_user&.admin?
      AuditLog.record_security_event!(action: "authorization.admin_denied", actor: @current_user, outcome: "denied", metadata: { path: request.path })
      render_forbidden("Admin access required")
    end
  end

  def require_staff!
    authenticate_user! unless @current_user
    return if performed?

    unless @current_user&.staff?
      AuditLog.record_security_event!(action: "authorization.staff_denied", actor: @current_user, outcome: "denied", metadata: { path: request.path })
      render_forbidden("Staff access required")
    end
  end

  def find_or_create_user(clerk_id:, email:, first_name:, last_name:)
    return nil if clerk_id.blank?

    normalized_email = email&.downcase

    # First try to find by clerk_id - this is the primary key from Clerk
    user = User.find_by(clerk_id: clerk_id)

    if user
      return user unless user.personal_access_enabled?

      # Only update if we have new info and it's different
      updates = {}
      updates[:email] = normalized_email if normalized_email.present? && normalized_email != user.email&.downcase && !user.email.to_s.include?("@placeholder.local")
      if user.uses_clerk_profile?
        updates[:first_name] = first_name if first_name.present? && first_name != user.first_name
        updates[:last_name] = last_name if last_name.present? && last_name != user.last_name
      end

      safely_sync_clerk_profile(user, updates) if updates.any?
      return user
    end

    # Try to find by email (for invited users who haven't signed in yet)
    if normalized_email.present?
      user = User.where(personal_access_enabled: true).find_by("LOWER(email) = ?", normalized_email)

      if user
        previous_identity = {
          "clerk_id" => user.clerk_id,
          "profile_source" => user.profile_source
        }
        updates = { clerk_id: clerk_id, profile_source: "clerk" }
        updates[:first_name] = first_name if first_name.present? && first_name != user.first_name
        updates[:last_name] = last_name if last_name.present? && last_name != user.last_name
        if safely_sync_clerk_profile(user, updates)
          log_clerk_activation(user, previous_identity)
          return user
        end

        return nil
      end
    else
      Rails.logger.warn "No email available for clerk_id=#{clerk_id}. Cannot link invited user. Verify Clerk JWT template includes email claim or set CLERK_SECRET_KEY."
    end

    Rails.logger.warn "No invited user found for clerk_id=#{clerk_id}, email=#{normalized_email}" if normalized_email.present?

    # Bootstrap is disabled by default. Only allow it when explicitly enabled.
    if allow_first_user_bootstrap? && User.count.zero?
      user_email = normalized_email.presence || "#{clerk_id}@placeholder.local"
      new_user = User.create(
        clerk_id: clerk_id,
        email: user_email,
        first_name: first_name,
        last_name: last_name,
        role: "admin",
        personal_access_enabled: true,
        profile_source: "clerk",
        time_tracking_enabled: false
      )
      return new_user if new_user.persisted?
    end

    # User not invited - return nil (will trigger access denied)
    nil
  end

  def safely_sync_clerk_profile(user, updates)
    user.update!(updates)
    true
  rescue ActiveRecord::RecordNotUnique
    Rails.logger.warn("Clerk profile sync skipped for user=#{user.id}: database uniqueness conflict")
    user.reload
    false
  rescue ActiveRecord::RecordInvalid => e
    Rails.logger.warn(
      "Clerk profile sync skipped for user=#{user.id}: #{e.record.errors.full_messages.join(', ')}"
    )
    user.reload
    false
  end

  def resolve_user_from_claims(decoded)
    identity = identity_attributes_from(decoded)
    find_or_create_user(**identity)
  end

  def set_session_fingerprint(decoded)
    session_identifier = decoded["sid"].presence || decoded["jti"].presence
    Current.session_fingerprint = Digest::SHA256.hexdigest(session_identifier.to_s) if session_identifier
  end

  def log_clerk_activation(user, previous_identity)
    AuditLog.log(
      auditable: user,
      action: "updated",
      changes_made: {
        "clerk_id" => [ previous_identity["clerk_id"], user.clerk_id ],
        "profile_source" => [ previous_identity["profile_source"], user.profile_source ]
      },
      metadata: "personal account activated through Clerk"
    )
  rescue StandardError => e
    Rails.logger.warn("Clerk activation audit failed for user=#{user.id}: #{e.message}")
  end

  def identity_attributes_from(decoded)
    clerk_id = decoded["sub"]
    email = email_from_claims(decoded)

    if email.blank? && clerk_id.present?
      Rails.logger.info "JWT for clerk_id=#{clerk_id} has no email claim. Attempting Clerk API fallback."
      email = ClerkAuth.fetch_user_email(clerk_id)
      if email.present?
        Rails.logger.debug "Clerk API resolved email for clerk_id=#{clerk_id}"
      else
        Rails.logger.warn "JWT for clerk_id=#{clerk_id} has no email claim and Clerk API fallback failed. Ensure Clerk JWT template includes the email claim or set CLERK_SECRET_KEY."
      end
    end

    {
      clerk_id: clerk_id,
      email: email,
      first_name: decoded["first_name"] || decoded.dig("user", "first_name"),
      last_name: decoded["last_name"] || decoded.dig("user", "last_name")
    }
  end

  def email_from_claims(decoded)
    direct = decoded["email"] || decoded["email_address"] || decoded["primary_email_address"]
    return direct if direct.present?

    nested = decoded.dig("user", "email") || decoded.dig("user", "email_address") || decoded.dig("user", "primary_email_address")
    return nested if nested.present?

    emails = decoded["email_addresses"] || decoded.dig("user", "email_addresses")
    if emails.is_a?(Array)
      primary_id = decoded["primary_email_address_id"] || decoded.dig("user", "primary_email_address_id")
      primary = emails.find { |address| address.is_a?(Hash) && address["id"] == primary_id }
      first = primary || emails.find { |address| address.is_a?(Hash) }
      return first["email_address"] || first["email"] if first
    end

    nil
  end

  def allow_first_user_bootstrap?
    ActiveModel::Type::Boolean.new.cast(ENV.fetch("ALLOW_FIRST_USER_BOOTSTRAP", "false"))
  end

  def render_unauthorized(message = "Unauthorized")
    render json: { error: message }, status: :unauthorized
  end

  def render_forbidden(message = "Forbidden")
    render json: { error: message }, status: :forbidden
  end
end
