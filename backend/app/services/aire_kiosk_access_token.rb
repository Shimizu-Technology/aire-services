# frozen_string_literal: true

class AireKioskAccessToken
  PURPOSE = :aire_kiosk_access
  EXPIRY = 12.hours

  class << self
    def issue_for(admin, issued_at: Time.current)
      raise ArgumentError, "Only managers and admins can unlock the kiosk" unless admin&.can_unlock_kiosk?

      session = KioskDeviceSession.create!(user: admin, expires_at: expires_at(issued_at: issued_at))
      verifier.generate(
        {
          admin_id: admin.id,
          device_id: session.id,
          issued_at: issued_at.to_i
        },
        purpose: PURPOSE,
        expires_in: EXPIRY
      )
    end

    def admin_from_token(token)
      payload = verifier.verified(token, purpose: PURPOSE)
      return nil unless payload.is_a?(Hash)

      session = KioskDeviceSession.find_by(id: payload["device_id"] || payload[:device_id], revoked_at: nil)
      return nil unless session && session.expires_at > Time.current

      admin = User.find_by(id: payload["admin_id"] || payload[:admin_id])
      return nil unless admin&.can_unlock_kiosk? && admin.is_active?

      admin
    rescue ActiveSupport::MessageVerifier::InvalidSignature
      nil
    end

    def device_from_token(token)
      return nil unless admin_from_token(token)

      payload = verifier.verified(token, purpose: PURPOSE)
      KioskDeviceSession.find_by(id: payload["device_id"] || payload[:device_id])
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
