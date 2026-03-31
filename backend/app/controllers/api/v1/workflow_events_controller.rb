# frozen_string_literal: true

module Api
  module V1
    class WorkflowEventsController < BaseController
      before_action :authenticate_user!
      before_action :require_staff!

      def index
        @events = WorkflowEvent
          .includes(:user, tax_return: [:client, :workflow_stage])
          .order(created_at: :desc)

        # Filter by event type
        if params[:event_type].present?
          @events = @events.where(event_type: params[:event_type])
        end

        # Filter by user
        if params[:user_id].present?
          @events = @events.where(user_id: params[:user_id])
        end

        # Filter by date range
        if params[:start_date].present?
          @events = @events.where("created_at >= ?", Date.parse(params[:start_date]).beginning_of_day)
        end

        if params[:end_date].present?
          @events = @events.where("created_at <= ?", Date.parse(params[:end_date]).end_of_day)
        end

        # Pagination
        page = (params[:page] || 1).to_i
        per_page = (params[:per_page] || 50).to_i.clamp(1, 100)
        
        total_count = @events.count
        @events = @events.offset((page - 1) * per_page).limit(per_page)

        render json: {
          events: @events.map { |event| serialize_event(event) },
          pagination: {
            current_page: page,
            per_page: per_page,
            total_count: total_count,
            total_pages: (total_count.to_f / per_page).ceil
          }
        }
      end

      private

      def serialize_event(event)
        {
          id: event.id,
          event_type: event.event_type,
          description: event.description,
          old_value: event.old_value,
          new_value: event.new_value,
          created_at: event.created_at.iso8601,
          user: event.user ? {
            id: event.user.id,
            name: event.user.full_name,
            email: event.user.email
          } : nil,
          tax_return: {
            id: event.tax_return.id,
            tax_year: event.tax_return.tax_year,
            client: {
              id: event.tax_return.client.id,
              name: "#{event.tax_return.client.first_name} #{event.tax_return.client.last_name}"
            },
            current_status: event.tax_return.workflow_stage&.name
          }
        }
      end
    end
  end
end
