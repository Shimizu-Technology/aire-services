# frozen_string_literal: true

# Concern for Clerk JWT authentication
# Include in controllers that require authentication
module ClerkAuthenticatable
  extend ActiveSupport::Concern

  INVITE_ONLY_MESSAGE = "Access denied. You haven't been invited to this system. Please contact an administrator.".freeze

  private

  def authenticate_user!
    header = request.headers["Authorization"]

    unless header.present?
      render_unauthorized("Missing authorization header")
      return
    end

    token = header.split(" ").last
    decoded = ClerkAuth.verify(token)

    unless decoded
      render_unauthorized("Invalid or expired token")
      return
    end

    @current_user = resolve_user_from_claims(decoded)

    unless @current_user
      render_forbidden(INVITE_ONLY_MESSAGE)
      return # rubocop:disable Style/RedundantReturn -- consistent with other early-exits in this method
    end

    unless @current_user.is_active?
      render_forbidden("Your access has been deactivated. Please contact an administrator.")
      return
    end
  end

  def authenticate_user_optional
    header = request.headers["Authorization"]
    return unless header.present?

    token = header.split(" ").last
    decoded = ClerkAuth.verify(token)
    return unless decoded

    resolved_user = resolve_user_from_claims(decoded)
    @current_user = resolved_user if resolved_user&.is_active?
  end

  def current_user
    @current_user
  end

  def require_admin!
    authenticate_user! unless @current_user
    return if performed?

    unless @current_user&.admin?
      render_forbidden("Admin access required")
    end
  end

  def require_staff!
    authenticate_user! unless @current_user
    return if performed?

    unless @current_user&.staff?
      render_forbidden("Staff access required")
    end
  end

  def find_or_create_user(clerk_id:, email:, first_name:, last_name:)
    return nil if clerk_id.blank?

    normalized_email = email&.downcase

    # First try to find by clerk_id - this is the primary key from Clerk
    user = User.find_by(clerk_id: clerk_id)

    if user
      # Only update if we have new info and it's different
      updates = {}
      updates[:email] = normalized_email if normalized_email.present? && normalized_email != user.email&.downcase && !user.email.to_s.include?("@placeholder.local")
      updates[:first_name] = first_name if first_name.present? && first_name != user.first_name
      updates[:last_name] = last_name if last_name.present? && last_name != user.last_name

      user.update(updates) if updates.any?
      return user
    end

    # Try to find by email (for invited users who haven't signed in yet)
    if normalized_email.present?
      user = User.find_by("LOWER(email) = ?", normalized_email)

      if user
        updates = { clerk_id: clerk_id }
        updates[:first_name] = first_name if first_name.present? && first_name != user.first_name
        updates[:last_name] = last_name if last_name.present? && last_name != user.last_name
        user.update(updates)
        return user
      end
    else
      Rails.logger.warn "No email in JWT for clerk_id=#{clerk_id}. Cannot link invited user. Verify Clerk JWT template includes email claim."
    end

    # Bootstrap is disabled by default. Only allow it when explicitly enabled.
    if allow_first_user_bootstrap? && User.count.zero?
      user_email = normalized_email.presence || "#{clerk_id}@placeholder.local"
      new_user = User.create(
        clerk_id: clerk_id,
        email: user_email,
        first_name: first_name,
        last_name: last_name,
        role: "admin"
      )
      return new_user if new_user.persisted?
    end

    # User not invited - return nil (will trigger access denied)
    nil
  end

  def resolve_user_from_claims(decoded)
    identity = identity_attributes_from(decoded)
    find_or_create_user(**identity)
  end

  def identity_attributes_from(decoded)
    clerk_id = decoded["sub"]
    email = decoded["email"] || decoded["primary_email_address"]

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
      first_name: decoded["first_name"],
      last_name: decoded["last_name"]
    }
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
