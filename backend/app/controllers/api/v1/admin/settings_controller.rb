# frozen_string_literal: true

module Api
  module V1
    module Admin
      class SettingsController < Api::V1::BaseController
        before_action :authenticate_user!
        before_action :require_admin!

        EDITABLE_KEYS = %w[
          overtime_daily_threshold_hours
          overtime_weekly_threshold_hours
          early_clock_in_buffer_minutes
          schedule_required_for_clock_in
        ].freeze

        # GET /api/v1/admin/settings
        def index
          render json: { settings: Setting.all_as_hash }
        end

        # PATCH /api/v1/admin/settings
        def update
          updates = params.permit(settings: {}).to_h["settings"] || {}

          updates.each do |key, value|
            unless EDITABLE_KEYS.include?(key)
              return render json: { error: "Setting '#{key}' is not editable" }, status: :unprocessable_entity
            end
          end

          ActiveRecord::Base.transaction do
            updates.each do |key, value|
              Setting.set(key, value.to_s)
            end
          end

          render json: { settings: Setting.all_as_hash, message: "Settings updated" }
        end
      end
    end
  end
end
