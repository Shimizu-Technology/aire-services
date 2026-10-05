# frozen_string_literal: true

module Api
  module V1
    module Payroll
      module Cockpit
        class EmployeePeriodsController < BaseController
          PAYROLL_COMMAND_CAPABILITY = "settlement_case_management"
          before_action :authenticate_payroll_actor!

          def index
            render_evidence
          end

          def show
            render_evidence(period_id: params[:id])
          end

          private

          def render_evidence(period_id: nil)
            user = User.staff.find(params[:employee_id])
            if params[:source_user_uuid].blank? || params[:source_user_uuid] != user.payroll_integration_uuid
              return render json: { error: "Exact source employee identity is required" }, status: :conflict
            end
            render json: ::Payroll::EmployeePeriodEvidence.new(user: user, params: params.permit(:start_date, :end_date, :cursor, :per_page, :detail_cursor, :detail_per_page).to_h).call(period_id: period_id)
          rescue ArgumentError => error
            render json: { error: error.message }, status: :unprocessable_entity
          end
        end
      end
    end
  end
end
