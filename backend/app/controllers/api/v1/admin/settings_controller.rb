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
        APPROVAL_SETTING_KEYS = [ Setting::MANAGERS_CAN_APPROVE_OWN_TIME_KEY ].freeze
        PAY_STUB_SETTING_KEYS = [ Setting::PAY_STUB_KIOSK_REQUESTS_KEY, Setting::PAY_STUB_SELF_EMAIL_KEY ].freeze
        SCHEDULE_SETTING_KEYS = [ Setting::SCHEDULES_ENABLED_KEY ].freeze
        SETTING_KEYS = (CLOCK_SETTING_KEYS + APPROVAL_SETTING_KEYS + PAY_STUB_SETTING_KEYS + SCHEDULE_SETTING_KEYS).freeze
        # On/off switches: each change gets its own before/after audit row.
        BOOLEAN_SETTING_KEYS = (APPROVAL_SETTING_KEYS + PAY_STUB_SETTING_KEYS + SCHEDULE_SETTING_KEYS).freeze

        before_action :authenticate_user!
        before_action -> { require_capability!(:manage_settings) }

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

        def place_autocomplete
          query = params[:query].to_s.strip
          return render json: { error: "query is required" }, status: :unprocessable_entity if query.blank?

          suggestions = GooglePlacesService.autocomplete(
            query: query,
            session_token: params[:session_token]
          )

          render json: {
            suggestions: suggestions
          }
        rescue GooglePlacesService::PlacesError => e
          render json: { error: e.message }, status: :unprocessable_entity
        end

        def place_details
          place_id = params[:place_id].to_s.strip
          return render json: { error: "place_id is required" }, status: :unprocessable_entity if place_id.blank?

          place = GooglePlacesService.details(
            place_id: place_id,
            session_token: params[:session_token]
          )

          render json: {
            place: place
          }
        rescue GooglePlacesService::PlacesError => e
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
            unknown = payload.keys.map(&:to_s) - SETTING_KEYS
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

              audited_before = BOOLEAN_SETTING_KEYS.select { |key| payload&.key?(key) }.index_with do |key|
                Setting.lock.find_by(key: key)&.value || Setting::DEFAULTS[key]
              end

              payload&.each do |key, value|
                Setting.set(key.to_s, value.to_s)
              end

              record_switch_changes!(audited_before, payload) if audited_before.any?

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
          SETTING_KEYS.index_with { |key| Setting.get(key) }
        end

        # Returns a hash of string keys => string values, or nil if :settings is absent.
        def settings_update_params
          return nil unless params.key?(:settings)

          permitted = params.require(:settings).permit(*SETTING_KEYS).to_h
          # A boolean false would otherwise be dropped as blank.
          BOOLEAN_SETTING_KEYS.each { |key| permitted[key] = permitted[key].to_s if permitted.key?(key) && permitted[key] == false }
          permitted.compact_blank
        end

        # Switches that change who may approve time, how pay stubs go out or
        # whether schedules are in use keep their own before/after audit row.
        def record_switch_changes!(before_values, payload)
          before_values.each do |key, before|
            after = payload.fetch(key).to_s
            next if before == after

            AuditLog.record!(
              action: "setting.#{key}_updated",
              auditable: Setting.find_by!(key: key),
              actor: current_user,
              event_category: "settings",
              changes: { key => [ before == "true", after == "true" ] },
              metadata: { key: key, enabled: after == "true" },
              mark_domain_recorded: false
            )
          end
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
          BOOLEAN_SETTING_KEYS.each do |key|
            next unless payload.key?(key)
            return "#{key.humanize} must be true or false" unless %w[true false].include?(payload[key].to_s)
          end

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

          location_enforced = if payload.key?("clock_in_location_enforced")
            ActiveModel::Type::Boolean.new.cast(payload["clock_in_location_enforced"])
          else
            Setting.get("clock_in_location_enforced") == "true"
          end

          if location_enforced
            latitude = payload.key?("clock_in_location_latitude") ? Setting.safe_float(payload["clock_in_location_latitude"]) : Setting.safe_float(Setting.get("clock_in_location_latitude"))
            longitude = payload.key?("clock_in_location_longitude") ? Setting.safe_float(payload["clock_in_location_longitude"]) : Setting.safe_float(Setting.get("clock_in_location_longitude"))
            radius_meters = payload.key?("clock_in_location_radius_meters") ? payload["clock_in_location_radius_meters"].to_i : Setting.get("clock_in_location_radius_meters").to_i

            return "Set a valid clock-in latitude and longitude before enabling location enforcement" if latitude.nil? || longitude.nil?
            return "Clock-in radius must be greater than 0 meters before enabling location enforcement" if radius_meters <= 0
          end

          nil
        end

        def validate_approval_groups(payload, live: false)
          normalized = Setting.normalize_approval_groups(payload)
          current_groups = live ? live_approval_groups : Setting.approval_groups
          removed_keys = current_groups.map { |group| group.fetch("key") } - normalized.map { |group| group.fetch("key") }
          return if removed_keys.empty?

          groups_scope = UserApprovalGroup.where(approval_group: removed_keys)
          groups_scope = groups_scope.lock if live
          in_use_keys = groups_scope.pluck(:approval_group).uniq
          return if in_use_keys.empty?

          labels = in_use_keys.map do |key|
            current_groups.find { |group| group["key"] == key }&.fetch("label", nil) || key.to_s.humanize
          end
          "Reassign users before removing departments currently in use: #{labels.join(', ')}"
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
