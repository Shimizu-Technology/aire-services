# frozen_string_literal: true

class AireKioskAccessToken
  PURPOSE = :aire_kiosk_access
  EXPIRY = 12.hours

  class << self
    def issue_for(admin, issued_at: Time.current)
      raise ArgumentError, "Only admins can unlock the kiosk" unless admin&.admin?

      verifier.generate(
        {
          admin_id: admin.id,
          issued_at: issued_at.to_i
        },
        purpose: PURPOSE,
        expires_in: EXPIRY
      )
    end

    def admin_from_token(token)
      payload = verifier.verified(token, purpose: PURPOSE)
      return nil unless payload.is_a?(Hash)

      admin = User.find_by(id: payload["admin_id"] || payload[:admin_id])
      return nil unless admin&.admin? && admin.is_active?

      admin
    rescue ActiveSupport::MessageVerifier::InvalidSignature
      nil
    end

    def expires_at(issued_at: Time.current)
      issued_at + EXPIRY
    end

    private

    def verifier
      @verifier ||= ActiveSupport::MessageVerifier.new(
        Rails.application.secret_key_base,
        digest: "SHA256",
        serializer: JSON
      )
    end
  end
end
