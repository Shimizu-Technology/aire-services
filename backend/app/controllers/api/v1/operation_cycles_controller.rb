# frozen_string_literal: true

module Api
  module V1
    # Authorization Model: All authenticated staff (admin or employee) can access all clients' data.
    # This is intentional for this small tax practice where all staff work on all clients.
    # The show action allows fetching any cycle by ID (verified via joins(:client) to ensure
    # the cycle belongs to a valid client). For multi-tenant isolation in the future,
    # add client-level permission checks to set_cycle.
    class OperationCyclesController < BaseController
      before_action :authenticate_user!
      before_action :require_staff!
      before_action :require_admin!, only: [ :generate ]
      before_action :set_client, only: [ :index, :generate ]
      before_action :set_cycle, only: [ :show ]

      # GET /api/v1/clients/:client_id/operation_cycles
      def index
        cycles_scope = @client.operation_cycles.includes(:operation_template, :generated_by).recent_first
        cycles, meta = paginate_relation(cycles_scope)
        render json: {
          operation_cycles: cycles.map { |cycle| serialize_cycle(cycle) },
          meta: meta
        }
      end

      # POST /api/v1/clients/:client_id/operation_cycles/generate
      def generate
        # Admin check is handled by before_action :require_admin!

        assignment = find_assignment
        template = assignment&.operation_template || find_template

        unless template
          return render json: { error: "operation_template_id or client_operation_assignment_id is required" },
                        status: :unprocessable_entity
        end

        service = GenerateOperationCycleService.new(
          client: @client,
          operation_template: template,
          assignment: assignment,
          period_start: parse_date(params[:period_start]),
          period_end: parse_date(params[:period_end]),
          generation_mode: "manual",
          generated_by: current_user
        )

        result = service.call
        if result.success?
          render json: { operation_cycle: serialize_cycle(result.cycle, include_tasks: true) }, status: :created
        else
          render json: { error: result.errors.join(", ") }, status: :unprocessable_entity
        end
      rescue Date::Error, ArgumentError => e
        render json: { error: "Invalid date format: #{e.message}" }, status: :unprocessable_entity
      end

      # GET /api/v1/operation_cycles/:id
      def show
        render json: { operation_cycle: serialize_cycle(@cycle, include_tasks: true) }
      end

      private

      def set_client
        @client = Client.find(params[:client_id])
      end

      def set_cycle
        # Authorization: All staff can access all clients in this system (by design).
        # Join through client ensures the cycle belongs to a valid, existing client.
        # For tenant isolation in the future, add client-level permissions here.
        @cycle = OperationCycle
          .joins(:client)
          .includes(
            :operation_template,
            :generated_by,
            operation_tasks: [ :assigned_to, :completed_by, :client, :operation_template_task, { linked_time_entry: :user } ]
          ).find(params[:id])
      end

      def find_assignment
        assignment_id = params[:client_operation_assignment_id]
        return nil if assignment_id.blank?

        @client.client_operation_assignments.find(assignment_id)
      end

      def find_template
        template_id = params[:operation_template_id]
        return nil if template_id.blank?

        # Scope to active templates only to prevent using inactive/deleted templates
        OperationTemplate.where(is_active: true).find(template_id)
      end

      def parse_date(raw)
        return nil if raw.blank?

        Date.parse(raw)
      end

      def serialize_cycle(cycle, include_tasks: false)
        payload = {
          id: cycle.id,
          client_id: cycle.client_id,
          operation_template_id: cycle.operation_template_id,
          operation_template_name: cycle.operation_template&.name,
          client_operation_assignment_id: cycle.client_operation_assignment_id,
          period_start: cycle.period_start,
          period_end: cycle.period_end,
          pay_date: cycle.pay_date,
          cycle_label: cycle.cycle_label,
          generation_mode: cycle.generation_mode,
          status: cycle.status,
          generated_at: cycle.generated_at&.iso8601,
          generated_by: cycle.generated_by ? {
            id: cycle.generated_by.id,
            name: cycle.generated_by.full_name
          } : nil,
          created_at: cycle.created_at.iso8601,
          updated_at: cycle.updated_at.iso8601
        }

        if include_tasks
          payload[:tasks] = cycle.operation_tasks.ordered.map { |task| serialize_task(task) }
        end

        payload
      end

      def serialize_task(task)
        {
          id: task.id,
          operation_cycle_id: task.operation_cycle_id,
          operation_template_task_id: task.operation_template_task_id,
          client_id: task.client_id,
          client_name: task.client&.full_name,
          title: task.title,
          description: task.description,
          status: task.status,
          position: task.position,
          due_at: task.due_at&.iso8601,
          notes: task.notes,
          evidence_required: task.evidence_required,
          evidence_note: task.evidence_note,
          proof_url: task.proof_url,
          unmet_prerequisites: task.unmet_prerequisite_tasks.map do |dep_task|
            {
              id: dep_task.id,
              title: dep_task.title,
              status: dep_task.status
            }
          end,
          assigned_to: task.assigned_to ? {
            id: task.assigned_to.id,
            name: task.assigned_to.full_name
          } : nil,
          completed_at: task.completed_at&.iso8601,
          completed_by: task.completed_by ? {
            id: task.completed_by.id,
            name: task.completed_by.full_name
          } : nil,
          linked_time_entry_id: task.linked_time_entry_id,
          linked_time_entry: task.linked_time_entry ? {
            id: task.linked_time_entry.id,
            work_date: task.linked_time_entry.work_date.iso8601,
            hours: task.linked_time_entry.hours.to_f,
            user_name: task.linked_time_entry.user.display_name || task.linked_time_entry.user.full_name
          } : nil
        }
      end

      def paginate_relation(relation)
        page = (params[:page] || 1).to_i
        page = 1 if page < 1
        per_page = (params[:per_page] || 100).to_i.clamp(1, 250)

        total_count = relation.count
        total_pages = (total_count / per_page.to_f).ceil
        total_pages = 1 if total_pages.zero?
        current_page = [ page, total_pages ].min
        offset = (current_page - 1) * per_page

        paginated = relation.offset(offset).limit(per_page)
        meta = {
          current_page: current_page,
          per_page: per_page,
          total_count: total_count,
          total_pages: total_pages
        }

        [ paginated, meta ]
      end
    end
  end
end
