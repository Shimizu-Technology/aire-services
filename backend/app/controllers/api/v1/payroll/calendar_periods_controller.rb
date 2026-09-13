# frozen_string_literal: true

module Api
  module V1
    module Payroll
      class CalendarPeriodsController < ApplicationController
        include SharedSecretAuthenticatable

        before_action :authenticate_shared_secret!
        rescue_from ActiveRecord::RecordNotFound, with: :period_not_found

        def index
          periods = PayrollCalendarPeriod.order(start_date: :desc).limit(100)
          render json: {
            schema_version: ::Payroll::CalendarPeriodPublisher::SCHEMA_VERSION,
            payroll_calendar_periods: periods.map(&:as_contract_json)
          }
        end

        def show
          period = find_period
          render json: period.as_contract_json.merge(
            revisions: period.payroll_calendar_period_revisions.order(:schedule_version).map do |revision|
              {
                schedule_version: revision.schedule_version,
                publication_id: revision.publication_id,
                request_checksum: revision.request_checksum,
                published_at: revision.published_at.iso8601,
                payload: revision.payload
              }
            end
          )
        end

        def update
          attributes = calendar_params.to_h.merge(external_pay_period_id: params[:id])
          result = ::Payroll::CalendarPeriodPublisher.new(attributes).call
          render json: {
            payroll_calendar_period: result.period.as_contract_json,
            idempotent: result.idempotent
          }, status: result.created ? :created : :ok
        rescue ArgumentError, ActiveRecord::RecordInvalid => e
          message = e.respond_to?(:record) ? e.record.errors.full_messages.join(", ") : e.message
          render json: { error: message }, status: :unprocessable_entity
        rescue ::Payroll::CalendarPeriodPublisher::ConflictError => e
          render json: { error: e.message }, status: :conflict
        end

        private

        def find_period
          PayrollCalendarPeriod.find_by!(external_pay_period_id: params[:id])
        end

        def period_not_found
          render json: { error: "Payroll calendar period not found" }, status: :not_found
        end

        def calendar_params
          params.permit(
            :schema_version,
            :start_date,
            :end_date,
            :pay_date,
            :cutoff_at,
            :time_zone,
            :cutoff_days_before,
            :schedule_version,
            :publication_id
          )
        end
      end
    end
  end
end
