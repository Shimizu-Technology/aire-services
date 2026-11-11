# frozen_string_literal: true

module Api
  module V1
    # GET /api/v1/attention: Today's "Needs attention" list in one request.
    # Supervisors only; each section follows the viewer's capabilities.
    class AttentionController < BaseController
      before_action -> { require_capability!(:manage_team_time) }
      before_action -> { response.headers["Cache-Control"] = "no-store" }

      def show
        render json: AttentionQuery.call(viewer: current_user)
      end
    end
  end
end
