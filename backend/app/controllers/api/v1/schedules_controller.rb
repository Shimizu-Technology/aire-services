# frozen_string_literal: true

module Api
  module V1
    class SchedulesController < BaseController
      before_action :authenticate_user!
      before_action :require_staff!
      before_action :require_admin!, only: [ :create, :update, :destroy, :bulk_create, :clear_week ]
      before_action :set_schedule, only: [ :show, :update, :destroy ]

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
        @approved_availability = approved_leave_for_index.to_a

        render json: {
          schedules: @schedules.map { |schedule| serialize_schedule(schedule) },
          approved_leave: @approved_availability.map { |leave| serialize_availability(leave) },
          users: User.staff.map { |u| { id: u.id, email: u.email, display_name: u.display_name, full_name: u.full_name } }
        }
      end

      # GET /api/v1/schedules/my
      # Get current user's upcoming schedule
      def my_schedule
        @schedules = current_user.schedules
                                 .upcoming
                                 .includes(:user, :created_by)
                                 .limit(14) # Next 2 weeks worth
        @schedules = @schedules.to_a
        preload_approved_availability(@schedules)

        render json: {
          schedules: @schedules.map { |schedule| serialize_schedule(schedule) }
        }
      end

      # GET /api/v1/schedules/:id
      def show
        preload_approved_availability([ @schedule ])
        render json: { schedule: serialize_schedule(@schedule) }
      end

      # POST /api/v1/schedules
      def create
        @schedule = Schedule.new(schedule_params)
        @schedule.created_by = current_user

        write_schedule!(@schedule, schedule_params, params.require(:schedule))
        render json: { schedule: serialize_schedule(@schedule) }, status: :created
      rescue Scheduling::ShiftWriter::LeaveConflict => e
        render_leave_conflict(e)
      end

      # POST /api/v1/schedules/bulk
      # Create multiple schedules at once (for quick scheduling)
      def bulk_create
        schedules_data = params[:schedules] || []
        created_schedules = []
        errors = []

        ActiveRecord::Base.transaction do
          User.where(id: schedules_data.map { |row| row[:user_id] }).order(:id).lock.load
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

            begin
              write_schedule!(schedule, {}, schedule_data)
              created_schedules << schedule
            rescue Scheduling::ShiftWriter::LeaveConflict => e
              errors << { user_id: schedule.user_id, date: schedule.work_date, code: "leave_conflict_acknowledgement_required", error: e.message, approved_leave: e.availability }
            rescue ActiveRecord::RecordInvalid
              errors << { user_id: schedule.user_id, date: schedule.work_date, errors: schedule.errors.full_messages }
            end
          end

          # Rollback if any errors
          raise ActiveRecord::Rollback if errors.any?
        end

        if errors.any?
          # Conflict events from earlier rows were rolled back with the batch.
          Current.domain_audit_recorded = false
          render json: { error: "Some schedules failed to create", details: errors }, status: :unprocessable_entity
        else
          preload_approved_availability(created_schedules)
          render json: { schedules: created_schedules.map { |s| serialize_schedule(s) } }, status: :created
        end
      end

      # PATCH /api/v1/schedules/:id
      def update
        write_schedule!(@schedule, schedule_params, params.require(:schedule))
        render json: { schedule: serialize_schedule(@schedule) }
      rescue Scheduling::ShiftWriter::LeaveConflict => e
        render_leave_conflict(e)
      end

      # DELETE /api/v1/schedules/:id
      def destroy
        @schedule.destroy
        head :no_content
      end

      # DELETE /api/v1/schedules/clear
      # Clear all schedules for a specific week (admin only)
      def clear_week
        unless params[:week].present?
          return render json: { error: "week parameter is required" }, status: :bad_request
        end

        week_start = Date.parse(params[:week])
        week_end = week_start + 6.days

        schedules = Schedule.for_date_range(week_start, week_end)

        if params[:user_id].present?
          schedules = schedules.for_user(params[:user_id])
        end

        count = schedules.count
        schedules.destroy_all

        render json: { message: "Cleared #{count} schedule(s)" }
      rescue Date::Error
        render json: { error: "Invalid week date format" }, status: :bad_request
      end

      private

      def write_schedule!(schedule, attributes, decision)
        Scheduling::ShiftWriter.call(
          schedule: schedule, attributes: attributes, actor: current_user,
          acknowledge_leave_conflict: decision[:acknowledge_leave_conflict],
          leave_conflict_reason: decision[:leave_conflict_reason],
          acknowledged_leave_ids: decision[:acknowledged_leave_ids]
        )
      end

      def render_leave_conflict(error)
        render json: { error: error.message, code: "leave_conflict_acknowledgement_required", approved_leave: error.availability }, status: :unprocessable_entity
      end

      # Availability deliberately excludes private reasons and review notes.
      # Leave is a warning, not a scheduling prohibition.
      def approved_leave_for_index
        scope = LeaveRequest.where(status: "approved", user_id: User.staff.select(:id))
        scope = scope.where(user_id: params[:user_id]) if params[:user_id].present?
        if params[:date].present?
          starts_on = ends_on = Date.parse(params[:date])
        elsif params[:week].present?
          starts_on = Date.parse(params[:week])
          ends_on = starts_on + 6.days
        elsif params[:start_date].present? && params[:end_date].present?
          starts_on = Date.parse(params[:start_date])
          ends_on = Date.parse(params[:end_date])
        else
          return scope.order(:start_date, :id)
        end
        scope.where("start_date <= ? AND end_date >= ?", ends_on, starts_on).order(:start_date, :id)
      end

      def serialize_availability(leave)
        { id: leave.id, user_id: leave.user_id, start_date: leave.start_date.iso8601, end_date: leave.end_date.iso8601 }
      end

      def set_schedule
        @schedule = if current_user.admin?
          Schedule.find(params[:id])
        else
          current_user.schedules.find(params[:id])
        end
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
        h, m = val.split(":").map(&:to_i)
        return nil unless h.between?(0, 23) && m.between?(0, 59)
        Time.utc(2000, 1, 1, h, m, 0)
      end

      def approved_leave_conflict?(schedule)
        if @approved_availability
          @approved_availability.any? { |leave| leave.user_id == schedule.user_id && schedule.work_date.between?(leave.start_date, leave.end_date) }
        else
          LeaveRequest.where(user_id: schedule.user_id, status: "approved").where("start_date <= ? AND end_date >= ?", schedule.work_date, schedule.work_date).exists?
        end
      end

      # One bounded user/date-range query avoids a query per response row. Bulk
      # batches may span gaps; leave within those gaps is intentionally over-fetched
      # and filtered by the exact user/date in approved_leave_conflict?.
      def preload_approved_availability(schedules)
        dates = schedules.map(&:work_date)
        @approved_availability = if dates.empty?
          []
        else
          LeaveRequest.where(user_id: schedules.map(&:user_id).uniq, status: "approved")
            .where("start_date <= ? AND end_date >= ?", dates.max, dates.min).to_a
        end
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
          approved_leave_conflict: approved_leave_conflict?(schedule),
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
