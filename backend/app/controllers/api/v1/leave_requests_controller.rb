# frozen_string_literal: true

module Api
  module V1
    class LeaveRequestsController < BaseController
      before_action :authenticate_user!
      before_action :require_staff!
      before_action :set_leave_request, only: [ :show, :approve, :decline, :cancel ]
      before_action :require_admin!, only: [ :approve, :decline ]

      def index
        requests = current_user.admin? ? LeaveRequest.all : current_user.leave_requests
        requests = requests.includes(:user, :reviewed_by, :cancelled_by)
        if params[:status].present?
          requests = if params[:status] == "reviewed"
            requests.where.not(status: "pending")
          else
            requests.where(status: params[:status])
          end
        end
        requests = requests.recent

        page = [ params[:page].to_i, 1 ].max
        per_page = params[:per_page].to_i
        per_page = 25 if per_page <= 0
        per_page = [ per_page, 100 ].min
        total_count = requests.count
        paged_requests = requests.offset((page - 1) * per_page).limit(per_page)

        render json: {
          leave_requests: paged_requests.map { |request| serialize_leave_request(request) },
          pagination: {
            current_page: page,
            per_page: per_page,
            total_count: total_count,
            total_pages: [ (total_count.to_f / per_page).ceil, 1 ].max
          }
        }
      end

      def show
        render json: { leave_request: serialize_leave_request(@leave_request) }
      end

      def create
        leave_request = current_user.leave_requests.build(leave_request_params)

        if leave_request.save
          AuditLog.log(
            auditable: leave_request,
            action: "created",
            user: current_user,
            metadata: "leave_request=#{leave_request.leave_type};status=pending"
          )

          render json: { leave_request: serialize_leave_request(leave_request) }, status: :created
        else
          render json: { error: leave_request.errors.full_messages.join(", ") }, status: :unprocessable_entity
        end
      end

      def approve
        review_request!("approved")
      end

      def decline
        review_request!("declined")
      end

      def cancel
        cancel_result = nil
        cancel_error = nil

        @leave_request.with_lock do
          unless @leave_request.cancelable_by?(current_user)
            cancel_error = "Only the request owner can cancel a pending leave request"
            next
          end

          @leave_request.update!(
            status: "cancelled",
            reviewed_by: nil,
            reviewed_at: nil,
            review_note: nil,
            cancelled_by: current_user,
            cancelled_at: Time.current
          )
          cancel_result = @leave_request
        end

        if cancel_error
          return render json: { error: cancel_error }, status: :forbidden
        end

        AuditLog.log(
          auditable: cancel_result,
          action: "updated",
          user: current_user,
          metadata: "leave_request_status=cancelled"
        )

        render json: { leave_request: serialize_leave_request(cancel_result) }
      end

      private

      def set_leave_request
        scope = current_user.admin? ? LeaveRequest : current_user.leave_requests
        @leave_request = scope.includes(:user, :reviewed_by, :cancelled_by).find(params[:id])
      rescue ActiveRecord::RecordNotFound
        render json: { error: "Leave request not found" }, status: :not_found
      end

      def leave_request_params
        params.require(:leave_request).permit(:leave_type, :start_date, :end_date, :reason)
      end

      def review_request!(status)
        review_result = nil
        error_response = nil

        @leave_request.with_lock do
          if @leave_request.user_id == current_user.id
            error_response = {
              error: "Admins cannot approve or decline their own leave requests",
              status: :unprocessable_entity
            }
            next
          end

          unless @leave_request.pending?
            error_response = {
              error: "Only pending leave requests can be reviewed",
              status: :unprocessable_entity
            }
            next
          end

          @leave_request.update!(
            status: status,
            reviewed_by: current_user,
            reviewed_at: Time.current,
            review_note: params[:review_note].presence,
            cancelled_by: nil,
            cancelled_at: nil
          )
          review_result = @leave_request
        end

        if error_response
          return render json: { error: error_response.fetch(:error) }, status: error_response.fetch(:status)
        end

        AuditLog.log(
          auditable: review_result,
          action: "updated",
          user: current_user,
          metadata: "leave_request_status=#{status}"
        )

        render json: { leave_request: serialize_leave_request(review_result) }
      end

      def serialize_leave_request(request)
        {
          id: request.id,
          leave_type: request.leave_type,
          start_date: request.start_date.iso8601,
          end_date: request.end_date.iso8601,
          status: request.status,
          reason: request.reason,
          review_note: request.review_note,
          total_days: request.total_days,
          reviewed_at: request.reviewed_at&.iso8601,
          cancelled_at: request.cancelled_at&.iso8601,
          created_at: request.created_at.iso8601,
          updated_at: request.updated_at.iso8601,
          user: {
            id: request.user.id,
            email: request.user.email,
            display_name: request.user.display_name,
            full_name: request.user.full_name
          },
          reviewed_by: request.reviewed_by ? {
            id: request.reviewed_by.id,
            full_name: request.reviewed_by.full_name
          } : nil,
          cancelled_by: request.cancelled_by ? {
            id: request.cancelled_by.id,
            full_name: request.cancelled_by.full_name
          } : nil
        }
      end
    end
  end
end
