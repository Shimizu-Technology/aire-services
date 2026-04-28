# frozen_string_literal: true

module Api
  module V1
    module Admin
      class KioskSessionsController < BaseController
        before_action :authenticate_user!
        before_action :require_admin!

        def create
          issued_at = Time.current

          render json: {
            kiosk_access_token: AireKioskAccessToken.issue_for(current_user, issued_at: issued_at),
            expires_at: AireKioskAccessToken.expires_at(issued_at: issued_at).iso8601,
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
