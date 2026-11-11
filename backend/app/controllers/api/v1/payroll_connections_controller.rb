# frozen_string_literal: true

module Api
  module V1
    # GET /api/v1/payroll_connection: Cornerstone Payroll connection health.
    class PayrollConnectionsController < BaseController
      before_action -> { require_capability!(:manage_payroll) }
      before_action -> { response.headers["Cache-Control"] = "no-store" }

      def show
        render json: ::Payroll::ConnectionStatus.call
      end
    end
  end
end
