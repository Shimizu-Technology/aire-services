# frozen_string_literal: true

module Api
  module V1
    module Admin
      class ScheduleTimePresetsController < BaseController
        before_action :authenticate_user!
        before_action :require_admin!
        before_action :set_preset, only: [:show, :update, :destroy]

        # GET /api/v1/admin/schedule_time_presets
        def index
          presets = ScheduleTimePreset.ordered

          render json: {
            presets: presets.map { |p| serialize_preset(p) }
          }
        end

        # GET /api/v1/admin/schedule_time_presets/:id
        def show
          render json: { preset: serialize_preset(@preset) }
        end

        # POST /api/v1/admin/schedule_time_presets
        def create
          preset = ScheduleTimePreset.new(preset_params)

          if preset.save
            render json: { preset: serialize_preset(preset) }, status: :created
          else
            render json: { error: preset.errors.full_messages.join(", ") }, status: :unprocessable_entity
          end
        end

        # PATCH/PUT /api/v1/admin/schedule_time_presets/:id
        def update
          if @preset.update(preset_params)
            render json: { preset: serialize_preset(@preset) }
          else
            render json: { error: @preset.errors.full_messages.join(", ") }, status: :unprocessable_entity
          end
        end

        # DELETE /api/v1/admin/schedule_time_presets/:id
        def destroy
          @preset.destroy
          head :no_content
        end

        # POST /api/v1/admin/schedule_time_presets/reorder
        def reorder
          positions = params[:positions] # Array of { id: X, position: Y }

          ActiveRecord::Base.transaction do
            positions.each do |pos|
              ScheduleTimePreset.find(pos[:id]).update!(position: pos[:position])
            end
          end

          render json: { success: true }
        rescue ActiveRecord::RecordNotFound, ActiveRecord::RecordInvalid => e
          render json: { error: e.message }, status: :unprocessable_entity
        end

        private

        def set_preset
          @preset = ScheduleTimePreset.find(params[:id])
        rescue ActiveRecord::RecordNotFound
          render json: { error: "Preset not found" }, status: :not_found
        end

        def preset_params
          params.require(:preset).permit(:label, :start_time, :end_time, :position, :active)
        end

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
            created_at: preset.created_at,
            updated_at: preset.updated_at
          }
        end
      end
    end
  end
end
