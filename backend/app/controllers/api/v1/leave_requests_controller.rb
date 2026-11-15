# frozen_string_literal: true

module Api
  module V1
    class LeaveRequestsController < BaseController
      rescue_from ActiveRecord::RecordInvalid, with: :invalid_leave

      before_action :authenticate_user!
      before_action :require_staff!
      before_action :set_leave_request, only: [ :show, :approve, :decline, :cancel, :change_decision, :undo, :undo_cancel ]
      before_action -> { require_capability!(:approve_leave) }, only: [ :approve, :decline, :change_decision, :undo ]

      def index
        requests = current_user.can_approve_leave? && params[:scope] != "mine" ? LeaveRequest.all : current_user.leave_requests
        requests = requests.includes(:decision_events, :reviewed_by, :cancelled_by, user: :user_approval_groups)
        if params[:status].present?
          requests = if params[:status] == "reviewed"
            requests.where.not(status: "pending")
          else
            requests.where(status: params[:status])
          end
        end
        start_date = parse_date_filter(:start_date)
        return if performed?
        end_date = parse_date_filter(:end_date)
        return if performed?
        if start_date && end_date && start_date > end_date
          return render json: { error: "start_date must be on or before end_date" }, status: :unprocessable_entity
        end
        requests = requests.where("end_date >= ?", start_date) if start_date
        requests = requests.where("start_date <= ?", end_date) if end_date
        requests = if params[:view] == "decisions" && current_user.can_approve_leave?
          requests.where(status: %w[approved declined]).or(
            requests.where(id: AuditLog.where(auditable_type: "LeaveRequest", action: %w[leave_request.approved leave_request.declined leave_request.decision_changed leave_request.decision_undone]).select(:auditable_id))
          ).order(Arel.sql("COALESCE(reviewed_at, updated_at) DESC, id DESC"))
        else
          requests.recent
        end

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

        saved = LeaveRequest.transaction do
          leave_request.save && AuditLog.record!(
            action: "leave_request.created",
            auditable: leave_request,
            actor: current_user,
            event_category: "leave",
            metadata: { leave_type: leave_request.leave_type, status: "pending", employee_id: current_user.id, employee_name: current_user.full_name }
          )
        end

        if saved
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

      def undo
        change_saved_decision!(undo: true)
      end

      def change_decision
        change_saved_decision!(undo: false)
      end

      def undo_cancel
        @leave_request.user.with_lock(User::EMPLOYEE_ROW_LOCK) do
          @leave_request.with_lock do
            unless @leave_request.user_id == current_user.id && @leave_request.status == "cancelled" &&
                   @leave_request.cancelled_by_id == current_user.id && @leave_request.cancelled_at &&
                   @leave_request.cancelled_at > 1.minute.ago
              return render json: { error: "This cancellation can no longer be undone. Request time off again." }, status: :unprocessable_entity
            end
            @leave_request.update!(status: "pending", cancelled_by: nil, cancelled_at: nil)
            AuditLog.record!(action: "leave_request.cancellation_undone", auditable: @leave_request,
                             actor: current_user, event_category: "leave")
          end
        end
        render json: { leave_request: serialize_leave_request(@leave_request) }
      rescue ActiveRecord::RecordInvalid => e
        render json: { error: e.record.errors.full_messages.to_sentence }, status: :unprocessable_entity
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
          AuditLog.record!(
            action: "leave_request.cancelled",
            auditable: @leave_request,
            actor: current_user,
            event_category: "leave",
            outcome: "cancelled",
            metadata: { employee_id: @leave_request.user_id, employee_name: @leave_request.user&.full_name }
          )
          cancel_result = @leave_request
        end

        if cancel_error
          return render json: { error: cancel_error }, status: :forbidden
        end

        render json: { leave_request: serialize_leave_request(cancel_result), server_time: Time.current.iso8601(6),
                       undo_until: (cancel_result.cancelled_at + 1.minute).iso8601(6) }
      end

      private

      def invalid_leave(exception)
        render json: { error: exception.record.errors.full_messages.join(", ").presence || "This leave request could not be saved." }, status: :unprocessable_entity
        write_default_audit_event
      end

      def change_saved_decision!(undo:)
        LeaveDecisionChange.new(@leave_request, current_user).call!(
          version: params[:version], status: params[:status], reason: params[:reason], employee_note: params[:employee_note], undo: undo
        )
        render json: { leave_request: serialize_leave_request(@leave_request) }
      rescue LeaveDecisionChange::Conflict => e
        render json: { error: e.message }, status: :conflict
      rescue LeaveDecisionChange::Invalid => e
        render json: { error: e.message }, status: :unprocessable_entity
      end

      def parse_date_filter(key)
        return nil if params[key].blank?

        Date.iso8601(params[key].to_s)
      rescue Date::Error
        render json: { error: "#{key} must be a valid ISO 8601 date (YYYY-MM-DD)" }, status: :unprocessable_entity
        nil
      end

      def set_leave_request
        scope = current_user.can_approve_leave? ? LeaveRequest : current_user.leave_requests
        @leave_request = scope.includes(:decision_events, :reviewed_by, :cancelled_by, user: :user_approval_groups).find(params[:id])
      rescue ActiveRecord::RecordNotFound
        render json: { error: "Leave request not found" }, status: :not_found
      end

      def leave_request_params
        params.require(:leave_request).permit(:leave_type, :start_date, :end_date, :reason)
      end

      def review_request!(status)
        review_result = nil
        error_response = nil

        @leave_request.user.with_lock(User::EMPLOYEE_ROW_LOCK) do
          @leave_request.with_lock do
            if @leave_request.user_id == current_user.id
              error_response = {
                error: "You cannot approve or decline your own leave request",
                status: :unprocessable_entity
              }
              next
            end

            if params.key?(:version) && params[:version].to_s != @leave_request.lock_version.to_s
              error_response = { error: "This leave request changed. Refresh and try again.", status: :conflict }
              next
            end

            unless @leave_request.pending?
              error_response = {
                error: "Only pending leave requests can be reviewed",
                status: :unprocessable_entity
              }
              next
            end

            if status == "declined" && params[:review_note].to_s.strip.blank?
              error_response = { error: "Write a short reason to decline this leave request.", status: :unprocessable_entity }
              next
            end

            @leave_request.update!(
              status: status,
              reviewed_by: current_user,
              reviewed_at: Time.current,
              review_note: params[:review_note].to_s.strip.presence,
              cancelled_by: nil,
              cancelled_at: nil
            )
            AuditLog.record!(
              action: "leave_request.#{status}",
              auditable: @leave_request,
              actor: current_user,
              event_category: "leave",
              outcome: status == "declined" ? "denied" : "succeeded",
              metadata: { review_note: params[:review_note].to_s.strip.presence,
                          employee_id: @leave_request.user_id, employee_name: @leave_request.user&.full_name }.compact
            )
            review_result = @leave_request
          end
        end

        if error_response
          return render json: { error: error_response.fetch(:error) }, status: error_response.fetch(:status)
        end

        render json: { leave_request: serialize_leave_request(review_result) }
      end

      def serialize_leave_request(request)
        request.association(:decision_events).reset if action_name.in?(%w[approve decline undo change_decision])
        {
          id: request.id,
          version: request.lock_version,
          undo_expires_at: request.initial_decision? && request.reviewed_at && request.status.in?(%w[approved declined]) ? (request.reviewed_at + 15.minutes).iso8601 : nil,
          decision_history: current_user.can_approve_leave? && request.user_id != current_user.id ? request.decision_events.map { |event| {
              action: event.action, at: event.occurred_at.iso8601, actor: event.actor_name,
              from: event.metadata["from"], to: event.metadata["to"], reason: event.metadata["reason"] || event.metadata["review_note"]
            } } : [],
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
            full_name: request.user.full_name,
            department: request.user.approval_group_labels.presence&.join(", ") || "Unassigned",
            approval_group_keys: request.user.approval_group_keys
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
