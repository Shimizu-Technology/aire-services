# frozen_string_literal: true

module Api
  module V1
    module Admin
      class SettingsController < BaseController
        CLOCK_SETTING_KEYS = %w[
          overtime_daily_threshold_hours
          overtime_weekly_threshold_hours
          early_clock_in_buffer_minutes
          schedule_required_for_clock_in
        ].freeze

        before_action :authenticate_user!
        before_action :require_admin!

        def show
          render json: {
            settings: serialized_settings,
            approval_groups: Setting.approval_groups
          }
        end

        def update
          payload = settings_update_params
          approval_groups_payload = approval_groups_update_params
          settings_present = !payload.nil?
          approval_groups_present = !approval_groups_payload.nil?
          if !settings_present && !approval_groups_present
            return render json: { error: "settings and/or approval_groups is required" }, status: :unprocessable_entity
          end
          if settings_present && payload.empty? && !approval_groups_present
            return render json: { error: "No valid settings to update" }, status: :unprocessable_entity
          end

          if settings_present
            unknown = payload.keys.map(&:to_s) - CLOCK_SETTING_KEYS
            if unknown.any?
              return render json: { error: "Unknown settings: #{unknown.join(", ")}" }, status: :unprocessable_entity
            end
          end

          if settings_present
            validation_error = validate_settings(payload)
            return render json: { error: validation_error }, status: :unprocessable_entity if validation_error
          end

          if approval_groups_present
            approval_groups_error = validate_approval_groups(approval_groups_payload)
            return render json: { error: approval_groups_error }, status: :unprocessable_entity if approval_groups_error
          end

          Setting.transaction do
            payload&.each do |key, value|
              Setting.set(key.to_s, value.to_s)
            end

            Setting.set_approval_groups!(approval_groups_payload) if approval_groups_present
          end

          render json: {
            settings: serialized_settings,
            approval_groups: Setting.approval_groups
          }
        end

        private

        def serialized_settings
          CLOCK_SETTING_KEYS.index_with { |key| Setting.get(key) }
        end

        # Returns a hash of string keys => string values, or nil if :settings is absent.
        def settings_update_params
          return nil unless params.key?(:settings)

          permitted = params.require(:settings).permit(*CLOCK_SETTING_KEYS)
          permitted.to_h.compact_blank
        end

        def approval_groups_update_params
          return nil unless params.key?(:approval_groups)

          Array(params[:approval_groups]).map do |group|
            next if group.nil?
            next group if group.is_a?(String)

            group.respond_to?(:permit) ? group.permit(:key, :label).to_h : group.to_h.slice("key", "label", :key, :label)
          end.compact
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

        def validate_approval_groups(payload)
          normalized = Setting.normalize_approval_groups(payload)
          removed_keys = Setting.approval_group_keys - normalized.map { |group| group.fetch("key") }
          return if removed_keys.empty?

          in_use_keys = User.where(approval_group: removed_keys).distinct.pluck(:approval_group)
          return if in_use_keys.empty?

          labels = in_use_keys.map { |key| Setting.approval_group_label_for(key) }
          "Reassign users before removing approval groups currently in use: #{labels.join(', ')}"
        rescue ArgumentError => e
          e.message
        end
      end
    end
  end
end
