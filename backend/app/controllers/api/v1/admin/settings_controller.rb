# frozen_string_literal: true

module Api
  module V1
    module Admin
      class SettingsController < BaseController
        ALLOWED_KEYS = Setting::DEFAULTS.keys.freeze

        before_action :authenticate_user!
        before_action :require_admin!

        def show
          render json: { settings: serialized_settings }
        end

        def update
          payload = settings_update_params
          if payload.nil?
            return render json: { error: "settings hash is required" }, status: :unprocessable_entity
          end
          if payload.empty?
            return render json: { error: "No valid settings to update" }, status: :unprocessable_entity
          end

          unknown = payload.keys.map(&:to_s) - ALLOWED_KEYS
          if unknown.any?
            return render json: { error: "Unknown settings: #{unknown.join(", ")}" }, status: :unprocessable_entity
          end

          validation_error = validate_settings(payload)
          return render json: { error: validation_error }, status: :unprocessable_entity if validation_error

          payload.each do |key, value|
            Setting.set(key.to_s, value.to_s)
          end

          render json: { settings: serialized_settings }
        end

        private

        def serialized_settings
          ALLOWED_KEYS.index_with { |key| Setting.get(key) }
        end

        # Returns a hash of string keys => string values, or nil if :settings is absent.
        def settings_update_params
          return nil unless params.key?(:settings)

          permitted = params.require(:settings).permit(*ALLOWED_KEYS)
          permitted.to_h.compact_blank
        end

        def validate_settings(payload)
          if payload.key?("overtime_daily_threshold_hours")
            v = payload["overtime_daily_threshold_hours"].to_f
            return "Daily overtime threshold must be greater than 0" if v <= 0
          end

          if payload.key?("overtime_weekly_threshold_hours")
            v = payload["overtime_weekly_threshold_hours"].to_f
            return "Weekly overtime threshold must be greater than 0" if v <= 0
          end

          if payload.key?("early_clock_in_buffer_minutes")
            v = payload["early_clock_in_buffer_minutes"].to_i
            return "Early clock-in buffer must be 0 or greater" if v.negative?
          end

          nil
        end
      end
    end
  end
end
