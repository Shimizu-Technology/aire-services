# frozen_string_literal: true

module Api
  module V1
    class SchedulesController < BaseController
      before_action :authenticate_user!
      before_action :require_staff!
      before_action :require_admin!, only: [:create, :update, :destroy, :bulk_create]
      before_action :set_schedule, only: [:show, :update, :destroy]

      # GET /api/v1/schedules
      # All staff can view schedules
      def index
        @schedules = Schedule.includes(:user, :created_by)

        # Filter by user
        if params[:user_id].present?
          @schedules = @schedules.for_user(params[:user_id])
        end

        # Filter by date
        if params[:date].present?
          @schedules = @schedules.for_date(Date.parse(params[:date]))
        elsif params[:week].present?
          # Week starts on Sunday
          week_start = Date.parse(params[:week])
          week_end = week_start + 6.days
          @schedules = @schedules.for_date_range(week_start, week_end)
        elsif params[:start_date].present? && params[:end_date].present?
          @schedules = @schedules.for_date_range(
            Date.parse(params[:start_date]),
            Date.parse(params[:end_date])
          )
        end

        @schedules = @schedules.ordered

        render json: {
          schedules: @schedules.map { |schedule| serialize_schedule(schedule) },
          users: User.staff.map { |u| { id: u.id, email: u.email, display_name: u.display_name, full_name: u.full_name } }
        }
      end

      # GET /api/v1/schedules/my
      # Get current user's upcoming schedule
      def my_schedule
        @schedules = current_user.schedules
                                 .upcoming
                                 .includes(:created_by)
                                 .limit(14) # Next 2 weeks worth

        render json: {
          schedules: @schedules.map { |schedule| serialize_schedule(schedule) }
        }
      end

      # GET /api/v1/schedules/:id
      def show
        render json: { schedule: serialize_schedule(@schedule) }
      end

      # POST /api/v1/schedules
      def create
        @schedule = Schedule.new(schedule_params)
        @schedule.created_by = current_user

        if @schedule.save
          render json: { schedule: serialize_schedule(@schedule) }, status: :created
        else
          render json: { error: @schedule.errors.full_messages.join(", ") }, status: :unprocessable_entity
        end
      end

      # POST /api/v1/schedules/bulk
      # Create multiple schedules at once (for quick scheduling)
      def bulk_create
        schedules_data = params[:schedules] || []
        created_schedules = []
        errors = []

        ActiveRecord::Base.transaction do
          schedules_data.each do |schedule_data|
            start_t = parse_time_as_utc(schedule_data[:start_time])
            end_t = parse_time_as_utc(schedule_data[:end_time])

            unless start_t && end_t
              errors << { schedule_data: schedule_data, error: "Invalid time format" }
              next
            end

            schedule = Schedule.new(
              user_id: schedule_data[:user_id],
              work_date: schedule_data[:work_date],
              start_time: start_t,
              end_time: end_t,
              notes: schedule_data[:notes],
              created_by: current_user
            )

            if schedule.save
              created_schedules << schedule
            else
              errors << { user_id: schedule_data[:user_id], date: schedule_data[:work_date], errors: schedule.errors.full_messages }
            end
          end

          # Rollback if any errors
          raise ActiveRecord::Rollback if errors.any?
        end

        if errors.any?
          render json: { error: "Some schedules failed to create", details: errors }, status: :unprocessable_entity
        else
          render json: { schedules: created_schedules.map { |s| serialize_schedule(s) } }, status: :created
        end
      end

      # PATCH /api/v1/schedules/:id
      def update
        if @schedule.update(schedule_params)
          render json: { schedule: serialize_schedule(@schedule) }
        else
          render json: { error: @schedule.errors.full_messages.join(", ") }, status: :unprocessable_entity
        end
      end

      # DELETE /api/v1/schedules/:id
      def destroy
        @schedule.destroy
        head :no_content
      end

      # DELETE /api/v1/schedules/clear
      # Clear all schedules for a specific week (admin only)
      def clear_week
        week_start = Date.parse(params[:week])
        week_end = week_start + 6.days

        schedules = Schedule.for_date_range(week_start, week_end)
        
        if params[:user_id].present?
          schedules = schedules.for_user(params[:user_id])
        end

        count = schedules.count
        schedules.destroy_all

        render json: { message: "Cleared #{count} schedule(s)" }
      end

      private

      def set_schedule
        @schedule = Schedule.find(params[:id])
      rescue ActiveRecord::RecordNotFound
        render json: { error: "Schedule not found" }, status: :not_found
      end

      def schedule_params
        permitted = params.require(:schedule).permit(
          :user_id,
          :work_date,
          :start_time,
          :end_time,
          :notes
        )
        normalize_time_to_utc(permitted, :start_time)
        normalize_time_to_utc(permitted, :end_time)
        permitted
      end

      def normalize_time_to_utc(params_hash, field)
        parsed = parse_time_as_utc(params_hash[field])
        params_hash[field] = parsed if parsed
      end

      def parse_time_as_utc(val)
        return nil unless val.present? && val.is_a?(String) && val.match?(/\A\d{1,2}:\d{2}\z/)
        h, m = val.split(':').map(&:to_i)
        return nil unless h.between?(0, 23) && m.between?(0, 59)
        Time.utc(2000, 1, 1, h, m, 0)
      end

      def serialize_schedule(schedule)
        {
          id: schedule.id,
          user_id: schedule.user_id,
          user: {
            id: schedule.user.id,
            email: schedule.user.email,
            display_name: schedule.user.display_name,
            full_name: schedule.user.full_name
          },
          work_date: schedule.work_date.iso8601,
          start_time: schedule.start_time.utc.strftime("%H:%M"),
          end_time: schedule.end_time.utc.strftime("%H:%M"),
          formatted_start_time: schedule.formatted_start_time,
          formatted_end_time: schedule.formatted_end_time,
          formatted_time_range: schedule.formatted_time_range,
          hours: schedule.hours,
          notes: schedule.notes,
          created_by: schedule.created_by ? {
            id: schedule.created_by.id,
            email: schedule.created_by.email
          } : nil,
          created_at: schedule.created_at.iso8601,
          updated_at: schedule.updated_at.iso8601
        }
      end
    end
  end
end
