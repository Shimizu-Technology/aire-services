# frozen_string_literal: true

module Api
  module V1
    module Admin
      class KioskSessionsController < BaseController
        before_action :authenticate_user!
        before_action -> { require_capability!(:unlock_kiosk) }

        def lock_all
          return render json: { error: "Administrator access required" }, status: :forbidden unless current_user.administrator?

          count = KioskDeviceSession.transaction do
            revoked = KioskDeviceSession.where(revoked_at: nil).where("expires_at > ?", Time.current).update_all(revoked_at: Time.current, updated_at: Time.current)
            AuditLog.record!(action: "kiosk.all_locked", actor: current_user, auditable: current_user, event_category: "security",
                             source: "admin", metadata: { revoked_count: revoked })
            revoked
          end
          render json: { revoked_count: count }
        end

        def create
          issued_at = Time.current

          token = AireKioskAccessToken.issue_for(current_user, issued_at: issued_at)
          device = AireKioskAccessToken.device_from_token(token)

          AuditLog.record!(
            action: "kiosk.unlocked",
            auditable: current_user,
            actor: current_user,
            event_category: "security",
            source: "admin",
            metadata: { device_id: device.id, expires_at: AireKioskAccessToken.expires_at(issued_at: issued_at).iso8601 }
          )

          render json: {
            kiosk_access_token: token,
            expires_at: AireKioskAccessToken.expires_at(issued_at: issued_at).iso8601,
            unlocked_by: {
              id: current_user.id,
              full_name: current_user.full_name
            }
          }, status: :created
        end
      end
    end
  end
end
