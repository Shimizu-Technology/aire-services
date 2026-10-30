# frozen_string_literal: true

module SharedSecretAuthenticatable
  extend ActiveSupport::Concern

  private

  def authenticate_shared_secret!
    unless ConnectedPayrollMode.enabled?
      response.headers["Retry-After"] = "60"
      render json: { error: ConnectedPayrollMode::MESSAGE, connected_payroll: ConnectedPayrollMode.capability }, status: :service_unavailable
      return
    end
    provided = request.headers["X-Shared-Secret"].presence || request.headers["X-Payroll-Shared-Secret"].presence
    unless provided.present?
      render json: { error: "Missing shared secret header" }, status: :unauthorized
      return
    end

    if StagingOutboundPolicy.staging?
      begin
        StagingOutboundPolicy.validate_shared_secret!
      rescue StagingOutboundPolicy::ConfigurationError
        Rails.logger.error("Staging payroll shared-secret configuration rejected")
        render json: { error: "Service unavailable" }, status: :service_unavailable
        return
      end
      expected = ENV.fetch("PAYROLL_SHARED_SECRET")
    else
      expected = ENV["PAYROLL_SHARED_SECRET"].presence || ENV["TIME_TRACKING_EXPORT_SECRET"].presence
    end
    unless expected.present?
      Rails.logger.error("PAYROLL_SHARED_SECRET or legacy TIME_TRACKING_EXPORT_SECRET is not configured")
      render json: { error: "Service unavailable" }, status: :service_unavailable
      return
    end

    provided_digest = Digest::SHA256.hexdigest(provided)
    expected_digest = Digest::SHA256.hexdigest(expected)

    unless ActiveSupport::SecurityUtils.fixed_length_secure_compare(provided_digest, expected_digest)
      render json: { error: "Invalid shared secret" }, status: :unauthorized
      return
    end

    instance_id = request.headers["X-Payroll-Source-Instance-Id"].to_s.strip
    if instance_id.present? && instance_id != Payroll::IntegrationProfile.source_instance_id
      render json: { error: "Payroll source installation does not match the connected source" }, status: :conflict
    end
  end
end
