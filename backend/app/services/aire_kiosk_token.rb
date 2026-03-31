# frozen_string_literal: true

class AireKioskToken
  PURPOSE = :aire_kiosk
  EXPIRY = 10.minutes

  class << self
    def issue_for(user)
      verifier.generate(
        {
          user_id: user.id,
          issued_at: Time.current.to_i
        },
        purpose: PURPOSE,
        expires_in: EXPIRY
      )
    end

    def user_from_token(token)
      payload = verifier.verified(token, purpose: PURPOSE)
      return nil unless payload.is_a?(Hash)

      User.find_by(id: payload["user_id"] || payload[:user_id])
    rescue ActiveSupport::MessageVerifier::InvalidSignature
      nil
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
