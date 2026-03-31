# frozen_string_literal: true

module Api
  module V1
    class PayrollChecklistPeriodsController < BaseController
      before_action :authenticate_user!
      before_action :require_staff!
      before_action :set_period, only: [:show, :complete, :reopen]
      before_action :require_admin!, only: [:reopen]

      # GET /api/v1/payroll_checklists/periods/:id
      def show
        render json: serialize_period_details(@period)
      end

      # POST /api/v1/payroll_checklists/periods
      def create
        client = Client.find(create_period_params[:client_id])
        template = PayrollChecklistTemplateService.ensure_default_template!(created_by: current_user)
        assignment = client.client_operation_assignments
          .joins(:operation_template)
          .where(assignment_status: "active")
          .where(operation_templates: { category: "payroll", is_active: true })
          .order(created_at: :desc)
          .first
        assignment ||= ClientOperationAssignment.find_or_create_by!(client: client, operation_template: template) do |record|
          record.assignment_status = "active"
          record.auto_generate = true
          record.cadence_type = "biweekly"
          record.cadence_interval = 2
          record.cadence_anchor = Date.parse(create_period_params[:start])
          record.created_by = current_user
        end

        if assignment.cadence_anchor.blank?
          assignment.update!(
            auto_generate: true,
            cadence_type: "biweekly",
            cadence_interval: 2,
            cadence_anchor: Date.parse(create_period_params[:start])
          )
        end

        service = GenerateOperationCycleService.new(
          client: client,
          operation_template: assignment.operation_template,
          assignment: assignment,
          period_start: Date.parse(create_period_params[:start]),
          period_end: Date.parse(create_period_params[:end]),
          generation_mode: "manual",
          generated_by: current_user,
          pay_date: create_period_params[:pay_date].presence && Date.parse(create_period_params[:pay_date])
        )

        result = service.call
        if result.success?
          render json: { period: serialize_period(result.cycle) }, status: :created
        else
          render json: { error: result.errors.join(", ") }, status: :unprocessable_entity
        end
      rescue Date::Error
        render json: { error: "Invalid date format" }, status: :unprocessable_entity
      end

      # POST /api/v1/payroll_checklists/periods/:id/complete
      def complete
        unless @period.operation_tasks.all? { |task| task.status == "done" }
          return render json: { error: "All required checklist items must be completed before closing period" },
                        status: :unprocessable_entity
        end

        @period.update!(status: "completed")
        AuditLog.log(
          auditable: @period,
          action: "updated",
          user: current_user,
          metadata: "Marked payroll checklist period complete"
        )
        render json: { period: { id: @period.id, status: "completed" } }
      end

      # POST /api/v1/payroll_checklists/periods/:id/reopen
      def reopen
        @period.update!(status: "active")
        AuditLog.log(
          auditable: @period,
          action: "updated",
          user: current_user,
          metadata: "Reopened payroll checklist period"
        )
        render json: { period: { id: @period.id, status: "open" } }
      end

      private

      def create_period_params
        params.permit(:client_id, :start, :end, :pay_date)
      end

      def set_period
        @period = OperationCycle
          .includes(:client, operation_tasks: :completed_by)
          .joins(:operation_template)
          .where(operation_templates: { category: "payroll" })
          .find(params[:id])
      end

      def serialize_period_details(period)
        {
          period: serialize_period(period).merge(
            done_count: period.operation_tasks.count { |item| item.status == "done" },
            total_count: period.operation_tasks.size
          ),
          items: period.operation_tasks.sort_by(&:position).map { |item| serialize_item(item) }
        }
      end

      def serialize_period(period)
        {
          id: period.id,
          client_id: period.client_id,
          client_name: period.client.full_name,
          start: period.period_start.iso8601,
          end: period.period_end.iso8601,
          pay_date: period.pay_date&.iso8601,
          status: period.status == "completed" ? "completed" : "open"
        }
      end

      def serialize_item(item)
        {
          id: item.id,
          key: item.title.to_s.parameterize(separator: "_"),
          label: item.title,
          position: item.position,
          required: true,
          done: item.status == "done",
          completed_at: item.completed_at&.iso8601,
          completed_by: item.completed_by ? { id: item.completed_by.id, name: item.completed_by.full_name } : nil,
          note: item.notes,
          proof_url: item.proof_url
        }
      end
    end
  end
end
