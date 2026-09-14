# frozen_string_literal: true

module Api
  module V1
    module Payroll
      module Cockpit
        class ManualReviewsController < BaseController
          def show
            review = ::Payroll::BatchBuilder.new(
              start_date: params[:start_date],
              end_date: params[:end_date],
              cutoff_at: Time.current,
              batch_reference: "MANUAL-REVIEW"
            ).call.fetch(:payload)

            render json: review.slice(
              :start_date,
              :end_date,
              :generated_at,
              :employees,
              :exclusions,
              :issues,
              :summary
            )
          rescue ArgumentError => e
            render json: { error: e.message }, status: :unprocessable_entity
          end
        end
      end
    end
  end
end
