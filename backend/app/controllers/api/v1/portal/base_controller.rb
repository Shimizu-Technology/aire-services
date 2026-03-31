# frozen_string_literal: true

module Api
  module V1
    module Portal
      class BaseController < Api::V1::BaseController
        before_action :require_client!
        before_action :ensure_client_exists!

        private

        def current_client
          @current_client ||= current_user&.client
        end

        def ensure_client_exists!
          return if performed?

          unless current_client
            render_forbidden("Client profile not found. Please contact support.")
          end
        end
      end
    end
  end
end
