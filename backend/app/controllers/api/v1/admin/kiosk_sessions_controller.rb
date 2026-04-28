# frozen_string_literal: true

module Api
  module V1
    module Admin
      class KioskSessionsController < BaseController
        before_action :authenticate_user!
        before_action :require_admin!

        def create
          render json: {
            kiosk_access_token: AireKioskAccessToken.issue_for(current_user),
            expires_at: AireKioskAccessToken.expires_at.iso8601,
            unlocked_by: {
              id: current_user.id,
              full_name: current_user.full_name
            }
          }, status: :created
        end
      end
    end
  end
end
