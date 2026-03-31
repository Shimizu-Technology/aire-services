# frozen_string_literal: true

module Api
  module V1
    class ScheduleTimePresetsController < BaseController
      before_action :authenticate_user!
      before_action :require_staff!

      # GET /api/v1/schedule_time_presets
      # Returns only active presets for use in the schedule form
      def index
        presets = ScheduleTimePreset.active.ordered

        render json: {
          presets: presets.map { |p| serialize_preset(p) }
        }
      end

      private

      def serialize_preset(preset)
        {
          id: preset.id,
          label: preset.label,
          start_time: preset.start_time_value,
          end_time: preset.end_time_value,
          formatted_start_time: preset.formatted_start_time,
          formatted_end_time: preset.formatted_end_time
        }
      end
    end
  end
end
