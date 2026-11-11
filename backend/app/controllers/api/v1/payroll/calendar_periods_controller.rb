# frozen_string_literal: true

module Api
  module V1
    module Payroll
      class CalendarPeriodsController < ApplicationController
        include SharedSecretAuthenticatable

        before_action :authenticate_shared_secret!
        rescue_from ActiveRecord::RecordNotFound, with: :period_not_found

        def index
          periods = PayrollCalendarPeriod.includes(:payroll_batch).order(start_date: :desc).limit(100)
          rollout = PayrollLockRollout.find_by(id: 1)
          next_cutoff = PayrollCalendarPeriod.next_scheduled_cutoff_at(rollout: rollout)
          render json: {
            next_scheduled_cutoff_at: next_cutoff,
            schema_version: ::Payroll::CalendarPeriodPublisher::SCHEMA_VERSION,
            payroll_calendar_periods: periods.map { |period| period.as_contract_json(rollout: rollout, next_scheduled_cutoff_at: next_cutoff) }
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
        rescue PayrollLockRollout::NotConfiguredError => e
          render json: { error: e.message }, status: :service_unavailable
        rescue ArgumentError, ActiveRecord::RecordInvalid => e
          message = e.respond_to?(:record) ? e.record.errors.full_messages.join(", ") : e.message
          record_rejection(message)
          render json: { error: message }, status: :unprocessable_entity
        rescue ::Payroll::CalendarPeriodPublisher::ConflictError => e
          record_rejection(e.message)
          render json: { error: e.message }, status: :conflict
        end

        private

        def record_rejection(message)
          ::Payroll::LockControl.record_rejection!(external_pay_period_id: params[:id], schedule_version: params[:schedule_version],
            publication_id: params[:publication_id], error: message)
        end

        def find_period
          PayrollCalendarPeriod.find_by!(external_pay_period_id: params[:id])
        end

        def period_not_found
          render json: { error: "Payroll calendar period not found" }, status: :not_found
        end

        def calendar_params
          if params[:overtime_policy].present?
            raise ArgumentError, "overtime_policy must be an object" unless params[:overtime_policy].respond_to?(:keys)

            allowed = ::Payroll::WeeklyOvertimeAllocator.configured_policy.keys.map(&:to_s)
            if (params[:overtime_policy].keys - allowed).any?
              raise ArgumentError, "overtime_policy contains unsupported fields"
            end
          end
          params.permit(
            :schema_version,
            :lock_mode,
            :cutoff_enforcement_starts_on,
            :start_date,
            :end_date,
            :pay_date,
            :cutoff_at,
            :time_zone,
            :cutoff_days_before,
            :cutoff_rule,
            :cutoff_days,
            :previous_regular_pay_date,
            :schedule_version,
            :publication_id,
            :cutoff_source,
            :policy_cutoff_at,
            overtime_policy: %i[schema_version calculation weekly_threshold_hours workweek_start time_zone],
            cutoff_override: [ :override_id, :action, :reason, :set_at, :previous_cutoff_at, { set_by: %i[name system role] } ]
          )
        end
      end
    end
  end
end
