# frozen_string_literal: true

module Api
  module V1
    class AuthController < BaseController
      # POST /api/v1/auth/me
      # Returns the current authenticated user
      # Used by frontend to verify authentication and get user info
      # Handles linking invited users via email from Clerk
      
      # Skip the standard authenticate_user! - we handle it custom here
      skip_before_action :authenticate_user!, only: [:me], raise: false

      def me
        header = request.headers["Authorization"]

        unless header.present?
          return render json: { error: "Missing authorization header" }, status: :unauthorized
        end

        token = header.split(" ").last
        decoded = ClerkAuth.verify(token)

        unless decoded
          return render json: { error: "Invalid or expired token" }, status: :unauthorized
        end

        clerk_id = decoded["sub"]
        email = decoded["email"] || decoded["primary_email_address"]

        # Fallback: if JWT lacks email, fetch it from Clerk Backend API
        if email.blank?
          Rails.logger.info "JWT for clerk_id=#{clerk_id} has no email claim. Attempting Clerk API fallback."
          email = ClerkAuth.fetch_user_email(clerk_id)
          if email.present?
            Rails.logger.debug "Clerk API resolved email for clerk_id=#{clerk_id}"
          else
            Rails.logger.warn "JWT for clerk_id=#{clerk_id} has no email claim and Clerk API fallback failed. Ensure Clerk JWT template includes the email claim or set CLERK_SECRET_KEY."
          end
        end

        # Find user by clerk_id first
        user = User.find_by(clerk_id: clerk_id)

        # If not found by clerk_id, try email (for invited users)
        if user.nil? && email.present?
          user = User.find_by("LOWER(email) = ?", email.downcase)
          
          if user
            # Link the clerk_id to this invited user
            user.update(clerk_id: clerk_id)
          end
        end

        # If still not found, check if this is the first user (auto-create admin)
        if user.nil? && User.count.zero?
          user = User.create(
            clerk_id: clerk_id,
            email: email || "#{clerk_id}@placeholder.local",
            role: "admin"
          )
        end

        # User not found and not first user = not invited
        if user.nil?
          return render json: { 
            error: "Access denied. You haven't been invited to this system. Please contact an administrator." 
          }, status: :forbidden
        end

        # Always sync email from Clerk (in case user changed it in Clerk)
        if email.present? && email.downcase != user.email.downcase
          user.update(email: email.downcase)
        end

        render json: {
          user: {
            id: user.id,
            email: user.email,
            first_name: user.first_name,
            last_name: user.last_name,
            full_name: user.full_name,
            role: user.role,
            is_admin: user.admin?,
            is_staff: user.staff?,
            is_client: user.client?,
            client_id: user.client_id,
            created_at: user.created_at
          }
        }
      end
    end
  end
end
