# frozen_string_literal: true

# Concern for Clerk JWT authentication
# Include in controllers that require authentication
module ClerkAuthenticatable
  extend ActiveSupport::Concern

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

    clerk_id = decoded["sub"]
    email = decoded["email"] || decoded["primary_email_address"]
    first_name = decoded["first_name"]
    last_name = decoded["last_name"]

    @current_user = find_or_create_user(
      clerk_id: clerk_id,
      email: email,
      first_name: first_name,
      last_name: last_name
    )

    unless @current_user
      render_unauthorized("Unable to authenticate user")
      return
    end
  end

  def authenticate_user_optional
    header = request.headers["Authorization"]
    return unless header.present?

    token = header.split(" ").last
    decoded = ClerkAuth.verify(token)
    return unless decoded

    clerk_id = decoded["sub"]
    @current_user = User.find_by(clerk_id: clerk_id)
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

  def require_client!
    authenticate_user! unless @current_user
    return if performed?

    unless @current_user&.client?
      render_forbidden("Client access required")
      return
    end

    unless @current_user&.client_id.present?
      render_forbidden("No client profile linked to this account")
      return
    end
  end

  def find_or_create_user(clerk_id:, email:, first_name:, last_name:)
    return nil if clerk_id.blank?

    # First try to find by clerk_id - this is the primary key from Clerk
    user = User.find_by(clerk_id: clerk_id)
    
    if user
      # Only update if we have new info and it's different
      updates = {}
      updates[:email] = email if email.present? && email != user.email && !user.email.include?("@placeholder.local")
      updates[:first_name] = first_name if first_name.present? && first_name != user.first_name
      updates[:last_name] = last_name if last_name.present? && last_name != user.last_name
      
      user.update(updates) if updates.any?
      return user
    end

    # Try to find by email (for invited users who haven't signed in yet)
    if email.present?
      user = User.find_by("LOWER(email) = ?", email.downcase)

      if user
        user.update(clerk_id: clerk_id)
        return user
      end
    else
      Rails.logger.warn "No email in JWT for clerk_id=#{clerk_id}. Cannot link invited user. Verify Clerk JWT template includes email claim."
    end

    # INVITE-ONLY: If user not found by clerk_id or email, they haven't been invited
    # Only exception: if there are NO users yet, create the first admin
    if User.count.zero?
      user_email = email.presence || "#{clerk_id}@placeholder.local"
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

  def render_unauthorized(message = "Unauthorized")
    render json: { error: message }, status: :unauthorized
  end

  def render_forbidden(message = "Forbidden")
    render json: { error: message }, status: :forbidden
  end
end
