# frozen_string_literal: true

module Api
  module V1
    # Published pay periods with their hand-off state to Cornerstone Payroll.
    # GET /api/v1/payroll_periods and /api/v1/payroll_periods/:start_date
    class PayrollPeriodsController < BaseController
      before_action -> { require_capability!(:manage_payroll) }
      before_action -> { response.headers["Cache-Control"] = "no-store" }

      def index
        limit = params[:limit].presence || ::Payroll::PeriodHandoffState::INDEX_LIMIT
        today = Time.current.in_time_zone(PayrollCalendarPeriod::BUSINESS_TIME_ZONE).to_date
        current = ::Payroll::PeriodHandoffState.current_period(today: today)
        render json: {
          periods: ::Payroll::PeriodHandoffState.index(limit: limit),
          current_start_date: current&.start_date&.iso8601,
          labels: ::Payroll::PeriodHandoffState.labels,
          connected_payroll: ConnectedPayrollMode.capability
        }
      end

      def show
        start_date = parse_start_date
        return if performed?

        state = ::Payroll::PeriodHandoffState.find(start_date)
        return render json: { error: "No pay period is published for that date", code: "not_published" }, status: :not_found unless state

        render json: {
          period: state.as_json,
          previous_start_date: PayrollCalendarPeriod.where(start_date: ...start_date).maximum(:start_date)&.iso8601,
          next_start_date: PayrollCalendarPeriod.where("start_date > ?", start_date).minimum(:start_date)&.iso8601,
          labels: ::Payroll::PeriodHandoffState.labels,
          connected_payroll: ConnectedPayrollMode.capability
        }
      end

      private

      def parse_start_date
        date = Date.iso8601(params[:start_date].to_s)
        return date if date.day == 1 || date.day == 16

        render json: { error: "A pay period starts on the 1st or the 16th" }, status: :unprocessable_entity
      rescue Date::Error
        render json: { error: "start_date must be a date (YYYY-MM-DD)" }, status: :unprocessable_entity
      end
    end
  end
end
