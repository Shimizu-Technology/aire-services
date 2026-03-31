# frozen_string_literal: true

module Api
  module V1
    class AuditLogsController < BaseController
      before_action :authenticate_user!
      before_action :require_staff!

      # GET /api/v1/audit_logs
      def index
        @audit_logs = AuditLog.includes(:user).recent

        # Filter by auditable type
        if params[:auditable_type].present?
          @audit_logs = @audit_logs.for_type(params[:auditable_type])
        end

        # Filter by action
        if params[:action_type].present?
          @audit_logs = @audit_logs.for_action(params[:action_type])
        end

        # Filter by user
        if params[:user_id].present?
          @audit_logs = @audit_logs.where(user_id: params[:user_id])
        end

        # Filter by client (CST-7)
        if params[:client_id].present?
          @audit_logs = @audit_logs.where(auditable_type: 'Client', auditable_id: params[:client_id])
        end

        # Filter by date range
        if params[:start_date].present?
          @audit_logs = @audit_logs.where("created_at >= ?", Date.parse(params[:start_date]).beginning_of_day)
        end

        if params[:end_date].present?
          @audit_logs = @audit_logs.where("created_at <= ?", Date.parse(params[:end_date]).end_of_day)
        end

        # Pagination
        page = (params[:page] || 1).to_i
        per_page = (params[:per_page] || 50).to_i.clamp(1, 100)
        total_count = @audit_logs.count
        @audit_logs = @audit_logs.offset((page - 1) * per_page).limit(per_page)

        render json: {
          audit_logs: @audit_logs.map { |log| serialize_audit_log(log) },
          pagination: {
            current_page: page,
            per_page: per_page,
            total_count: total_count,
            total_pages: (total_count.to_f / per_page).ceil
          }
        }
      end

      private

      def serialize_audit_log(log)
        {
          id: log.id,
          auditable_type: log.auditable_type,
          auditable_id: log.auditable_id,
          action: log.action,
          description: log.description,
          changes_made: log.changes_made,
          metadata: log.metadata,
          created_at: log.created_at.iso8601,
          user: log.user ? {
            id: log.user.id,
            email: log.user.email,
            name: log.user.full_name
          } : nil
        }
      end
    end
  end
end
