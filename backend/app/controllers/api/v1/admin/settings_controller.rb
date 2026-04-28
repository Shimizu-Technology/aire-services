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
          clock_in_location_enforced
          clock_in_location_name
          clock_in_location_latitude
          clock_in_location_longitude
          clock_in_location_radius_meters
        ].freeze

        before_action :authenticate_user!
        before_action :require_admin!

        def show
          render json: {
            settings: serialized_settings,
            approval_groups: Setting.approval_groups
          }
        end

        def geocode
          query = params[:query].to_s.strip
          return render json: { error: "query is required" }, status: :unprocessable_entity if query.blank?

          results = AddressGeocodingService.search(query: query)

          render json: {
            results: results
          }
        rescue AddressGeocodingService::GeocodingError => e
          render json: { error: e.message }, status: :unprocessable_entity
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

          approval_groups_error = nil
          Setting.transaction do
            persist_settings = lambda do
              if approval_groups_present
                approval_groups_error = validate_approval_groups(approval_groups_payload, live: true)
                raise ActiveRecord::Rollback if approval_groups_error.present?
              end

              payload&.each do |key, value|
                Setting.set(key.to_s, value.to_s)
              end

              Setting.set_approval_groups!(approval_groups_payload) if approval_groups_present
            end

            if approval_groups_present
              Setting.with_approval_groups_lock { persist_settings.call }
            else
              persist_settings.call
            end
          end

          return render json: { error: approval_groups_error }, status: :unprocessable_entity if approval_groups_error.present?

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

          if payload.key?("clock_in_location_radius_meters")
            v = payload["clock_in_location_radius_meters"].to_i
            return "Clock-in radius must be greater than 0 meters" if v <= 0
          end

          if payload.key?("clock_in_location_latitude")
            v = Setting.safe_float(payload["clock_in_location_latitude"])
            return "Clock-in latitude must be between -90 and 90" if v.nil? || v < -90 || v > 90
          end

          if payload.key?("clock_in_location_longitude")
            v = Setting.safe_float(payload["clock_in_location_longitude"])
            return "Clock-in longitude must be between -180 and 180" if v.nil? || v < -180 || v > 180
          end

          nil
        end

        def validate_approval_groups(payload, live: false)
          normalized = Setting.normalize_approval_groups(payload)
          current_groups = live ? live_approval_groups : Setting.approval_groups
          removed_keys = current_groups.map { |group| group.fetch("key") } - normalized.map { |group| group.fetch("key") }
          return if removed_keys.empty?

          users_scope = User.where(approval_group: removed_keys)
          users_scope = users_scope.lock if live
          in_use_keys = users_scope.pluck(:approval_group).compact.uniq
          return if in_use_keys.empty?

          labels = in_use_keys.map do |key|
            current_groups.find { |group| group["key"] == key }&.fetch("label", nil) || key.to_s.humanize
          end
          "Reassign users before removing approval groups currently in use: #{labels.join(', ')}"
        rescue ArgumentError => e
          e.message
        end

        def live_approval_groups
          value = Setting.lock.where(key: "approval_groups").pick(:value)
          Setting.parse_approval_groups(value)
        end
      end
    end
  end
end
