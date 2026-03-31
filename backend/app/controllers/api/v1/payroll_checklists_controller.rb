# frozen_string_literal: true

module Api
  module V1
    class PayrollChecklistsController < BaseController
      MAX_BOARD_PERIODS = 52
      before_action :authenticate_user!
      before_action :require_staff!

      # GET /api/v1/payroll_checklists/board?start=YYYY-MM-DD&end=YYYY-MM-DD
      def board
        start_date = parse_date(params[:start]) || Date.current.beginning_of_month
        end_date = parse_date(params[:end]) || Date.current.end_of_month
        if end_date < start_date
          return render json: { error: "end must be on or after start" }, status: :unprocessable_entity
        end

        periods = build_periods(start_date, end_date)
        assignments = ClientOperationAssignment
          .includes(:operation_template)
          .joins(:operation_template)
          .where(assignment_status: "active")
          .where(operation_templates: { category: "payroll", is_active: true })
          .order(created_at: :desc)
          .group_by(&:client_id)
          .transform_values { |list| list.first }
        client_ids = assignments.keys
        payroll_template_ids = assignments.values.map(&:operation_template_id).uniq

        if client_ids.empty?
          return render json: {
            periods: periods.map do |period|
              {
                start: period[:start].iso8601,
                end: period[:end].iso8601,
                label: period_label(period[:start], period[:end])
              }
            end,
            rows: []
          }
        end

        cycles = OperationCycle
          .includes(:operation_tasks)
          .where(client_id: client_ids, operation_template_id: payroll_template_ids, period_start: periods.first[:start]..periods.last[:start])
        cycles_by_key = cycles.index_by { |cycle| [cycle.client_id, cycle.operation_template_id, cycle.period_start, cycle.period_end] }
        cycle_counts = cycles.each_with_object({}) do |cycle, memo|
          tasks = cycle.operation_tasks.to_a
          memo[cycle.id] = {
            done_count: tasks.count { |task| task.status == "done" },
            total_count: tasks.size
          }
        end

        clients = Client.where(id: client_ids).order(:last_name, :first_name)
        template_tasks_by_template_id = OperationTemplateTask
          .where(operation_template_id: payroll_template_ids, is_active: true)
          .group_by(&:operation_template_id)

        rows = clients.map do |client|
          assignment = assignments[client.id]
          preferred_template_id = assignment.operation_template_id
          template_task_ids = (template_tasks_by_template_id[preferred_template_id] || []).map(&:id)
          excluded = Array(assignment.excluded_template_task_ids).map(&:to_i)
          expected_total = (template_task_ids - excluded).size
          expected_total = PayrollChecklistTemplateService::DEFAULT_STEPS.size if expected_total.zero?

          cells = periods.map do |period|
            cycle = cycles_by_key[[client.id, preferred_template_id, period[:start], period[:end]]]
            done_count = cycle ? cycle_counts.dig(cycle.id, :done_count) : 0
            total_count = cycle ? cycle_counts.dig(cycle.id, :total_count) : expected_total

            {
              period_start: period[:start].iso8601,
              period_end: period[:end].iso8601,
              checklist_period_id: cycle&.id,
              done_count: done_count,
              total_count: total_count,
              status: cycle ? checklist_period_status(cycle.status) : "open"
            }
          end

          {
            client_id: client.id,
            client_name: client.full_name,
            cells: cells
          }
        end

        render json: {
          periods: periods.map do |period|
            {
              start: period[:start].iso8601,
              end: period[:end].iso8601,
              label: period_label(period[:start], period[:end])
            }
          end,
          rows: rows
        }
      end

      private

      def parse_date(value)
        return nil if value.blank?

        Date.parse(value)
      rescue Date::Error
        nil
      end

      def build_periods(start_date, end_date)
        periods = []
        cursor = start_date

        while cursor <= end_date && periods.length < MAX_BOARD_PERIODS
          periods << { start: cursor, end: cursor + 13.days }
          cursor += 14.days
        end

        periods
      end

      def period_label(start_date, end_date)
        "#{start_date.strftime('%b %-d')}–#{end_date.strftime('%b %-d')}"
      end

      def checklist_period_status(cycle_status)
        cycle_status == "completed" ? "completed" : "open"
      end
    end
  end
end
