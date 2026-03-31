# frozen_string_literal: true

module Api
  module V1
    module Admin
      class TimePeriodLocksController < BaseController
        before_action :authenticate_user!
        before_action :require_admin!

        # POST /api/v1/admin/time_period_locks
        def create
          if params[:week].present?
            begin
              start_date, end_date = TimePeriodLock.week_bounds_for(Date.parse(params[:week]))
            rescue Date::Error, ArgumentError
              return render json: { error: "Invalid date format" }, status: :bad_request
            end
          else
            begin
              start_date = Date.parse(lock_params[:start_date])
              end_date = lock_params[:end_date].present? ? Date.parse(lock_params[:end_date]) : start_date + 6.days
            rescue Date::Error, ArgumentError
              return render json: { error: "Invalid date format" }, status: :bad_request
            end
          end

          lock = TimePeriodLock.new(
            start_date: start_date,
            end_date: end_date,
            locked_at: Time.current,
            locked_by: current_user,
            reason: lock_params[:reason]
          )

          if lock.save
            AuditLog.log(
              auditable: lock,
              action: "created",
              user: current_user,
              metadata: "Locked time period #{start_date} to #{end_date}"
            )

            render json: {
              lock: serialize_lock(lock),
              message: "Time period locked"
            }, status: :created
          else
            render json: { error: lock.errors.full_messages.join(", ") }, status: :unprocessable_entity
          end
        end

        # DELETE /api/v1/admin/time_period_locks/:id
        def destroy
          lock = TimePeriodLock.find(params[:id])
          metadata = "Unlocked time period #{lock.start_date} to #{lock.end_date}"
          lock_id = lock.id

          ActiveRecord::Base.transaction do
            lock.destroy!

            AuditLog.create!(
              auditable_type: "TimePeriodLock",
              auditable_id: lock_id,
              action: "deleted",
              user: current_user,
              metadata: metadata
            )
          end

          render json: { message: "Time period unlocked" }
        end

        private

        def lock_params
          params.permit(:start_date, :end_date, :reason)
        end

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
end
