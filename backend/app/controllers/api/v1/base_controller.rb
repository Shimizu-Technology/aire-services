# frozen_string_literal: true

module Api
  module V1
    class BaseController < ApplicationController
      include ClerkAuthenticatable

      rescue_from ActiveRecord::RecordNotFound, with: :not_found
      rescue_from ActiveRecord::RecordInvalid, with: :unprocessable_entity
      rescue_from ActionController::ParameterMissing, with: :bad_request
      rescue_from StandardError, with: :internal_server_error

      private

      def not_found(_exception)
        render json: { error: 'Record not found' }, status: :not_found
      end

      def unprocessable_entity(exception)
        render json: { error: exception.message, errors: exception.record&.errors&.full_messages }, status: :unprocessable_entity
      end

      def bad_request(exception)
        render json: { error: exception.message }, status: :bad_request
      end

      def internal_server_error(exception)
        Rails.logger.error("Unhandled exception: #{exception.class} - #{exception.message}")
        Rails.logger.error(exception.backtrace&.first(20)&.join("\n"))
        render json: { error: 'Internal server error', errors: ['An unexpected error occurred. Please try again later.'] }, status: :internal_server_error
      end
    end
  end
end
