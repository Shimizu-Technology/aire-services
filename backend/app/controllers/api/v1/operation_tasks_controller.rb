# frozen_string_literal: true

module Api
  module V1
    class OperationTasksController < BaseController
      before_action :authenticate_user!
      before_action :require_staff!
      before_action :set_task, only: [ :update, :complete, :reopen ]

      # GET /api/v1/operation_tasks
      def index
        tasks_scope = filtered_tasks
        tasks, meta = paginate_relation(tasks_scope)
        render json: {
          operation_tasks: tasks.map { |task| serialize_task(task) },
          meta: meta
        }
      end

      # GET /api/v1/operation_tasks/my_tasks
      def my_tasks
        tasks_scope = filtered_tasks.where(assigned_to_id: current_user.id)
        tasks, meta = paginate_relation(tasks_scope)
        render json: {
          operation_tasks: tasks.map { |task| serialize_task(task) },
          meta: meta
        }
      end

      # PATCH /api/v1/operation_tasks/:id
      def update
        previous = snapshot(@task)

        if @task.update(operation_task_params)
          unless normalize_completion_fields!
            return render json: { error: @task.errors.full_messages.join(", ") }, status: :unprocessable_entity
          end

          log_update(previous, @task)
          render json: { operation_task: serialize_task(@task) }
        else
          render json: { error: @task.errors.full_messages.join(", ") }, status: :unprocessable_entity
        end
      end

      # POST /api/v1/operation_tasks/:id/complete
      def complete
        previous = snapshot(@task)
        @task.assign_attributes(
          status: "done",
          completed_at: Time.current,
          completed_by: current_user,
          evidence_note: params[:evidence_note].presence || @task.evidence_note
        )

        if @task.save
          log_update(previous, @task, metadata: "Marked task done")
          render json: { operation_task: serialize_task(@task) }
        else
          render json: { error: @task.errors.full_messages.join(", ") }, status: :unprocessable_entity
        end
      end

      # POST /api/v1/operation_tasks/:id/reopen
      def reopen
        previous = snapshot(@task)
        @task.assign_attributes(status: "not_started", completed_at: nil, completed_by: nil)

        if @task.save
          log_update(previous, @task, metadata: "Reopened task")
          render json: { operation_task: serialize_task(@task) }
        else
          render json: { error: @task.errors.full_messages.join(", ") }, status: :unprocessable_entity
        end
      end

      private

      def set_task
        @task = OperationTask.includes(
          :assigned_to,
          :completed_by,
          :operation_template_task,
          { linked_time_entry: :user },
          { operation_cycle: [:operation_template, { operation_tasks: :operation_template_task }] }
        ).find(params[:id])
      end

      def filtered_tasks
        tasks = OperationTask.includes(
          :assigned_to,
          :completed_by,
          :client,
          :operation_template_task,
          { linked_time_entry: :user },
          { operation_cycle: [:operation_template, { operation_tasks: :operation_template_task }] }
        ).ordered

        tasks = tasks.where(status: params[:status]) if params[:status].present?
        tasks = tasks.where(assigned_to_id: params[:assigned_to_id]) if params[:assigned_to_id].present?
        tasks = tasks.where(client_id: params[:client_id]) if params[:client_id].present?

        case params[:due_filter]
        when "overdue"
          tasks = tasks.overdue
        when "today"
          tasks = tasks.where(due_at: Time.zone.now.beginning_of_day..Time.zone.now.end_of_day)
        when "upcoming"
          tasks = tasks.where(due_at: Time.zone.now.end_of_day..2.weeks.from_now.end_of_day)
        end

        if params[:include_done] != "true"
          tasks = tasks.where.not(status: "done")
        end

        tasks
      end

      def paginate_relation(relation)
        page = (params[:page] || 1).to_i
        page = 1 if page < 1
        per_page = (params[:per_page] || params[:limit] || 200).to_i.clamp(1, 500)

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

      def operation_task_params
        params.require(:operation_task).permit(
          :status,
          :assigned_to_id,
          :due_at,
          :notes,
          :evidence_note,
          :proof_url
        )
      end

      def normalize_completion_fields!
        return true unless @task.saved_change_to_status?

        if @task.status == "done"
          return true unless @task.completed_at.blank?

          # Keep validations for done state (evidence_required, etc.)
          return @task.update(completed_at: Time.current, completed_by_id: current_user.id)
        end

        if @task.completed_at.present? || @task.completed_by_id.present?
          # Clearing completion metadata should not rerun validations.
          @task.update_columns(completed_at: nil, completed_by_id: nil, updated_at: Time.current)
        end

        true
      end

      def snapshot(task)
        {
          status: task.status,
          assigned_to_id: task.assigned_to_id,
          due_at: task.due_at&.iso8601,
          notes: task.notes,
          evidence_note: task.evidence_note,
          completed_at: task.completed_at&.iso8601,
          completed_by_id: task.completed_by_id
        }
      end

      def log_update(previous, task, metadata: nil)
        current = snapshot(task.reload)

        changes = previous.each_with_object({}) do |(key, old_value), hash|
          new_value = current[key]
          hash[key] = { from: old_value, to: new_value } if old_value != new_value
        end

        AuditLog.log(
          auditable: task,
          action: "updated",
          user: current_user,
          changes_made: changes.presence,
          metadata: metadata || "Updated operation task #{task.id}"
        )
      end

      def serialize_task(task)
        {
          id: task.id,
          operation_cycle_id: task.operation_cycle_id,
          cycle_label: task.operation_cycle&.cycle_label,
          operation_template_name: task.operation_cycle&.operation_template&.name,
          operation_template_task_id: task.operation_template_task_id,
          client_id: task.client_id,
          client_name: task.client&.full_name,
          title: task.title,
          description: task.description,
          position: task.position,
          status: task.status,
          assigned_to: task.assigned_to ? {
            id: task.assigned_to.id,
            name: task.assigned_to.full_name
          } : nil,
          due_at: task.due_at&.iso8601,
          started_at: task.started_at&.iso8601,
          completed_at: task.completed_at&.iso8601,
          completed_by: task.completed_by ? {
            id: task.completed_by.id,
            name: task.completed_by.full_name
          } : nil,
          evidence_required: task.evidence_required,
          evidence_note: task.evidence_note,
          proof_url: task.proof_url,
          notes: task.notes,
          unmet_prerequisites: task.unmet_prerequisite_tasks.map do |dep_task|
            {
              id: dep_task.id,
              title: dep_task.title,
              status: dep_task.status
            }
          end,
          linked_time_entry_id: task.linked_time_entry_id,
          linked_time_entry: task.linked_time_entry ? {
            id: task.linked_time_entry.id,
            work_date: task.linked_time_entry.work_date.iso8601,
            hours: task.linked_time_entry.hours.to_f,
            user_name: task.linked_time_entry.user.display_name || task.linked_time_entry.user.full_name
          } : nil,
          created_at: task.created_at.iso8601,
          updated_at: task.updated_at.iso8601
        }
      end
    end
  end
end
