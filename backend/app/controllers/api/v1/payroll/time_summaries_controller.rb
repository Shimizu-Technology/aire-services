# frozen_string_literal: true

module Api
  module V1
    module Payroll
      class TimeSummariesController < ApplicationController
        include SharedSecretAuthenticatable

        before_action :authenticate_shared_secret!

        def show
          render json: ::Payroll::TimeSummaryBuilder.new(
            start_date: params[:start_date],
            end_date: params[:end_date]
          ).call
        rescue ArgumentError => e
          render json: { error: e.message }, status: :unprocessable_entity
        end
      end
    end
  end
end
