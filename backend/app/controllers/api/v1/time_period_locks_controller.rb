# frozen_string_literal: true

module Api
  module V1
    class TimePeriodLocksController < BaseController
      before_action :authenticate_user!
      before_action :require_staff!

      # GET /api/v1/time_period_locks?week=YYYY-MM-DD
      def index
        if params[:week].present?
          begin
            week_start, week_end = TimePeriodLock.week_bounds_for(Date.parse(params[:week]))
          rescue Date::Error, ArgumentError
            return render json: { error: "Invalid date format" }, status: :bad_request
          end

          lock = TimePeriodLock.where(start_date: week_start, end_date: week_end).includes(:locked_by).first

          render json: {
            week_start: week_start,
            week_end: week_end,
            locked: lock.present?,
            lock: lock ? serialize_lock(lock) : nil
          }
          return
        end

        locks = TimePeriodLock.recent.limit(20).includes(:locked_by)
        render json: { locks: locks.map { |lock| serialize_lock(lock) } }
      end

      private

      def serialize_lock(lock)
        {
          id: lock.id,
          start_date: lock.start_date,
          end_date: lock.end_date,
          locked_at: lock.locked_at,
          reason: lock.reason,
          locked_by: {
            id: lock.locked_by.id,
            full_name: lock.locked_by.full_name,
            email: lock.locked_by.email
          }
        }
      end
    end
  end
end
