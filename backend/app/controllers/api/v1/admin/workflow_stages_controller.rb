# frozen_string_literal: true

module Api
  module V1
    module Admin
      class WorkflowStagesController < BaseController
        before_action :authenticate_user!
        before_action :require_admin!
        before_action :set_workflow_stage, only: [:show, :update, :destroy, :move]

        # GET /api/v1/admin/workflow_stages
        # Returns all workflow stages (including inactive)
        def index
          stages = WorkflowStage.ordered

          render json: {
            workflow_stages: stages.map { |stage| stage_response(stage) }
          }
        end

        # GET /api/v1/admin/workflow_stages/:id
        def show
          render json: { workflow_stage: stage_response(@workflow_stage) }
        end

        # POST /api/v1/admin/workflow_stages
        def create
          stage = WorkflowStage.new(stage_params)
          # Auto-assign position to end
          stage.position ||= WorkflowStage.maximum(:position).to_i + 1

          if stage.save
            render json: { workflow_stage: stage_response(stage) }, status: :created
          else
            render json: { errors: stage.errors.full_messages }, status: :unprocessable_entity
          end
        end

        # PATCH /api/v1/admin/workflow_stages/:id
        def update
          if @workflow_stage.update(stage_params)
            render json: { workflow_stage: stage_response(@workflow_stage) }
          else
            render json: { errors: @workflow_stage.errors.full_messages }, status: :unprocessable_entity
          end
        end

        # DELETE /api/v1/admin/workflow_stages/:id
        def destroy
          # Soft delete - mark as inactive
          if @workflow_stage.update(is_active: false)
            render json: { message: "Workflow stage deactivated" }
          else
            render json: { errors: @workflow_stage.errors.full_messages }, status: :unprocessable_entity
          end
        end

        # POST /api/v1/admin/workflow_stages/:id/move
        # Move stage to new position
        def move
          new_position = params[:position].to_i

          if new_position < 1
            render json: { error: "Invalid position" }, status: :unprocessable_entity
            return
          end

          reorder_stages(@workflow_stage, new_position)

          render json: {
            message: "Stage moved to position #{new_position}",
            workflow_stages: WorkflowStage.ordered.map { |s| stage_response(s) }
          }
        end

        # POST /api/v1/admin/workflow_stages/reorder
        # Bulk reorder stages
        def reorder
          stage_ids = params[:stage_ids]

          unless stage_ids.is_a?(Array)
            render json: { error: "stage_ids must be an array" }, status: :unprocessable_entity
            return
          end

          ActiveRecord::Base.transaction do
            stage_ids.each_with_index do |id, index|
              WorkflowStage.where(id: id).update_all(position: index + 1)
            end
          end

          render json: {
            message: "Stages reordered",
            workflow_stages: WorkflowStage.ordered.map { |s| stage_response(s) }
          }
        end

        private

        def set_workflow_stage
          @workflow_stage = WorkflowStage.find(params[:id])
        end

        def stage_params
          params.require(:workflow_stage).permit(
            :name, :slug, :color, :notify_client, :is_active, :position
          )
        end

        def stage_response(stage)
          {
            id: stage.id,
            name: stage.name,
            slug: stage.slug,
            position: stage.position,
            color: stage.color,
            notify_client: stage.notify_client,
            is_active: stage.is_active,
            tax_returns_count: stage.tax_returns.count,
            created_at: stage.created_at,
            updated_at: stage.updated_at
          }
        end

        def reorder_stages(stage, new_position)
          old_position = stage.position

          if new_position > old_position
            # Moving down - shift others up
            WorkflowStage.where("position > ? AND position <= ?", old_position, new_position)
                         .update_all("position = position - 1")
          else
            # Moving up - shift others down
            WorkflowStage.where("position >= ? AND position < ?", new_position, old_position)
                         .update_all("position = position + 1")
          end

          stage.update!(position: new_position)
        end
      end
    end
  end
end
