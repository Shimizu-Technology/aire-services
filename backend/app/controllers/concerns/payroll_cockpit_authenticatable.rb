# frozen_string_literal: true

module PayrollCockpitAuthenticatable
  extend ActiveSupport::Concern

  include SharedSecretAuthenticatable

  private

  def authenticate_payroll_cockpit!
    authenticate_shared_secret!
    audit_payroll_authorization_denial(nil, "service_authentication_failed") if performed?
  end

  def authenticate_payroll_actor!
    return if performed?

    delegation_token = request.headers["X-Aire-Delegation-Token"].to_s
    if delegation_token.blank?
      audit_payroll_authorization_denial(nil, "delegation_token_missing")
      return render json: { error: "Missing X-Aire-Delegation-Token header" }, status: :unauthorized
    end

    grant = PayrollIntegrationGrant.authenticate(delegation_token)
    unless grant
      audit_payroll_authorization_denial(nil, "delegation_invalid")
      return render json: { error: "AIRE payroll delegation is invalid or expired" }, status: :forbidden
    end

    @payroll_actor = grant.user
    unless @payroll_actor&.is_active? && @payroll_actor.personal_access_enabled?
      audit_payroll_authorization_denial(grant.token_hint, "actor_not_active")
      return render json: { error: "AIRE actor is not active" }, status: :forbidden
    end

    required_capability = self.class::PAYROLL_COMMAND_CAPABILITY
    unless @payroll_actor.admin? && grant.allows?(required_capability)
      audit_payroll_authorization_denial(grant.token_hint, "capability_required", actor: @payroll_actor)
      return render json: { error: "This AIRE payroll delegation does not allow that action" }, status: :forbidden
    end

    @payroll_grant = grant
    Current.user = @payroll_actor
  end

  def payroll_actor
    @payroll_actor
  end

  def audit_payroll_authorization_denial(delegation_hint, reason, actor: nil)
    AuditLog.record!(
      action: "payroll_cockpit.authorization_denied",
      actor: actor,
      actor_kind: actor ? "user" : "integration",
      source: "integration",
      outcome: "denied",
      event_category: "security",
      subject_type: "PayrollCockpit",
      subject_id: 0,
      subject_name: "Cornerstone payroll cockpit",
      metadata: { delegation_hint: delegation_hint, reason: reason, path: request.path }.compact
    )
  rescue StandardError => e
    Rails.logger.warn("Payroll cockpit authorization audit failed: #{e.class}: #{e.message}")
  end
end
