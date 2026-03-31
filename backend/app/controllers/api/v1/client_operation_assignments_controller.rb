# frozen_string_literal: true

module Api
  module V1
    class ClientOperationAssignmentsController < BaseController
      before_action :authenticate_user!
      before_action :require_admin!
      before_action :set_client, only: [:index, :create]
      before_action :set_assignment, only: [:update]

      # GET /api/v1/clients/:client_id/operation_assignments
      def index
        assignments = @client.client_operation_assignments.includes(:operation_template).order(created_at: :desc)
        render json: { assignments: assignments.map { |assignment| serialize_assignment(assignment) } }
      end

      # POST /api/v1/clients/:client_id/operation_assignments
      def create
        attrs = assignment_params.merge(created_by: current_user)
        template = OperationTemplate.find_by(id: attrs[:operation_template_id])
        if template&.name == PayrollChecklistTemplateService::DEFAULT_TEMPLATE_NAME
          attrs[:auto_generate] = true if attrs[:auto_generate].nil?
          attrs[:cadence_type] = "biweekly"
          attrs[:cadence_interval] = 2
          attrs[:cadence_anchor] ||= attrs[:starts_on] || Date.current
        end

        assignment = @client.client_operation_assignments.new(attrs)

        if assignment.save
          render json: { assignment: serialize_assignment(assignment) }, status: :created
        else
          render json: { error: assignment.errors.full_messages.join(", ") }, status: :unprocessable_entity
        end
      end

      # PATCH /api/v1/client_operation_assignments/:id
      def update
        if @assignment.update(assignment_params)
          render json: { assignment: serialize_assignment(@assignment) }
        else
          render json: { error: @assignment.errors.full_messages.join(", ") }, status: :unprocessable_entity
        end
      end

      private

      def set_client
        @client = Client.find(params[:client_id])
      end

      def set_assignment
        # Admin-only controller (require_admin!), so admin can access any assignment
        # Join through client to ensure assignment belongs to a valid client
        @assignment = ClientOperationAssignment
          .joins(:client)
          .includes(:operation_template)
          .find(params[:id])
      end

      def assignment_params
        params.require(:assignment).permit(
          :operation_template_id,
          :auto_generate,
          :assignment_status,
          :starts_on,
          :ends_on,
          excluded_template_task_ids: []
        )
      end

      def serialize_assignment(assignment)
        {
          id: assignment.id,
          client_id: assignment.client_id,
          operation_template_id: assignment.operation_template_id,
          operation_template_name: assignment.operation_template&.name,
          auto_generate: assignment.auto_generate,
          assignment_status: assignment.assignment_status,
          starts_on: assignment.starts_on,
          ends_on: assignment.ends_on,
          excluded_template_task_ids: assignment.excluded_template_task_ids || [],
          created_by_id: assignment.created_by_id,
          created_at: assignment.created_at.iso8601,
          updated_at: assignment.updated_at.iso8601
        }
      end
    end
  end
end
