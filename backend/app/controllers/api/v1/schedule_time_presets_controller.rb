# frozen_string_literal: true

module Api
  module V1
    class ScheduleTimePresetsController < BaseController
      before_action :authenticate_user!
      before_action :require_staff!

      def index
        presets = ScheduleTimePreset.active.ordered

        render json: {
          presets: presets.map { |preset| serialize_preset(preset) }
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
          formatted_end_time: preset.formatted_end_time,
          position: preset.position,
          active: preset.active,
          created_at: preset.created_at.iso8601,
          updated_at: preset.updated_at.iso8601
        }
      end
    end
  end
end
