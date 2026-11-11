# frozen_string_literal: true

module Api
  module V1
    # GET /api/v1/access_guide: the Roles & access page. Any signed-in team
    # member can read it; only owners and admins get the names of who holds
    # each role.
    class AccessGuidesController < BaseController
      before_action :authenticate_user!
      before_action :require_staff!

      def show
        render json: AccessGuide.new(viewer: current_user).as_json
      end
    end
  end
end
