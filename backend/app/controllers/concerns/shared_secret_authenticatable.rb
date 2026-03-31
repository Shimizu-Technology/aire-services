# frozen_string_literal: true

# Concern for shared-secret authentication on service-to-service API endpoints.
# Include in controllers that accept requests from trusted internal services
# (e.g., CPR payroll system) rather than Clerk-authenticated users.
module SharedSecretAuthenticatable
  extend ActiveSupport::Concern

  private

  def authenticate_shared_secret!
    provided = request.headers["X-Shared-Secret"]

    unless provided.present?
      render json: { error: "Missing X-Shared-Secret header" }, status: :unauthorized
      return
    end

    expected = ENV["PAYROLL_SHARED_SECRET"]

    unless expected.present?
      Rails.logger.error("PAYROLL_SHARED_SECRET is not configured")
      render json: { error: "Service unavailable" }, status: :service_unavailable
      return
    end

    unless ActiveSupport::SecurityUtils.secure_compare(provided, expected)
      render json: { error: "Invalid shared secret" }, status: :unauthorized
      return
    end
  end
end
