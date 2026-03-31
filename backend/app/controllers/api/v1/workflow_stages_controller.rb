# frozen_string_literal: true

module Api
  module V1
    class WorkflowStagesController < BaseController
      # GET /api/v1/workflow_stages
      # Returns all active workflow stages, ordered by position
      def index
        stages = WorkflowStage.active.ordered

        render json: {
          workflow_stages: stages.map { |stage| stage_response(stage) }
        }
      end

      private

      def stage_response(stage)
        {
          id: stage.id,
          name: stage.name,
          slug: stage.slug,
          position: stage.position,
          color: stage.color,
          notify_client: stage.notify_client
        }
      end
    end
  end
end
