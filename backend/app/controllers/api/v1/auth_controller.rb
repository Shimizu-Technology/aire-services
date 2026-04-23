# frozen_string_literal: true

module Api
  module V1
    class AuthController < BaseController
      before_action :authenticate_user!
      before_action :require_staff!, only: [ :update_kiosk_pin ]

      def me
        render json: { user: serialize_current_user(current_user) }
      end

      def update_kiosk_pin
        pin = params[:pin].to_s.strip

        if pin.blank?
          return render json: { error: "PIN is required" }, status: :unprocessable_entity
        end

        current_user.skip_kiosk_pin_presence_validation = true
        current_user.rotate_kiosk_pin!(pin, enabled: true)

        render json: {
          user: serialize_current_user(current_user.reload),
          message: "Your kiosk PIN has been set"
        }
      rescue ActiveRecord::RecordInvalid => e
        messages = e.record.errors.map do |err|
          err.attribute == :kiosk_pin_lookup_hash && err.type == :taken ? err.message : err.full_message
        end
        render json: { error: messages.join(", ") }, status: :unprocessable_entity
      end

      private

      def serialize_current_user(user)
        {
          id: user.id,
          email: user.email,
          first_name: user.first_name,
          last_name: user.last_name,
          full_name: user.full_name,
          role: user.role,
          approval_group: user.approval_group,
          is_active: user.is_active,
          is_admin: user.admin?,
          is_staff: user.staff?,
          kiosk_enabled: user.kiosk_enabled,
          kiosk_pin_configured: user.kiosk_pin_configured?,
          kiosk_pin_last_rotated_at: user.kiosk_pin_last_rotated_at&.iso8601,
          needs_kiosk_pin_setup: user.staff? && !user.kiosk_pin_configured?,
          created_at: user.created_at
        }
      end
    end
  end
end
