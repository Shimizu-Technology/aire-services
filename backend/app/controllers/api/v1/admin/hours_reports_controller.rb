# frozen_string_literal: true

module Api
  module V1
    module Admin
      class HoursReportsController < BaseController
        REPORT_PARAM_KEYS = %i[
          start_date
          end_date
          user_id
          role
          status
          approval_group
          time_category_id
          clock_source
          entry_method
          approval_status
          overtime_status
          include_empty
        ].freeze

        before_action :authenticate_user!
        before_action :require_admin!

        def show
          render json: ::Payroll::HoursReportBuilder.new(report_params).call
        rescue ArgumentError => e
          render json: { error: e.message }, status: :unprocessable_entity
        end

        private

        def report_params
          REPORT_PARAM_KEYS.index_with { |key| params[key] }.compact
        end
      end
    end
  end
end
