# frozen_string_literal: true

module Api
  module V1
    class AuthController < BaseController
      before_action :authenticate_user!

      def me
        render json: {
          user: {
            id: current_user.id,
            email: current_user.email,
            first_name: current_user.first_name,
            last_name: current_user.last_name,
            full_name: current_user.full_name,
            role: current_user.role,
            is_admin: current_user.admin?,
            is_staff: current_user.staff?,
            created_at: current_user.created_at
          }
        }
      end
    end
  end
end
