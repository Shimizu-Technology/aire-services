# frozen_string_literal: true

module Api
  module V1
    module Admin
      class EmployeePeriodsController < BaseController
        before_action :authenticate_user!
        before_action :require_admin!

        def index
          render_evidence
        end

        def show
          render_evidence(period_id: params[:id])
        end

        private

        def render_evidence(period_id: nil)
          user = User.staff.find(params[:user_id])
          render json: ::Payroll::EmployeePeriodEvidence.new(user: user, params: params.permit(:start_date, :end_date, :cursor, :per_page, :detail_cursor, :detail_per_page).to_h).call(period_id: period_id)
        rescue ArgumentError => error
          render json: { error: error.message }, status: :unprocessable_entity
        end
      end
    end
  end
end
