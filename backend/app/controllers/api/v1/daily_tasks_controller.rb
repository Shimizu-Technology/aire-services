# frozen_string_literal: true

module Api
  module V1
    class DailyTasksController < BaseController
      before_action :authenticate_user!
      before_action :require_staff!
      before_action :set_task, only: [ :show, :update, :destroy, :complete, :reopen ]

      # GET /api/v1/daily_tasks
      def index
        tasks_scope = filtered_tasks
        render json: {
          daily_tasks: tasks_scope.map { |task| serialize_task(task) }
        }
      end

      # GET /api/v1/daily_tasks/my_tasks
      def my_tasks
        tasks_scope = filtered_tasks.where(assigned_to_id: current_user.id)
        render json: {
          daily_tasks: tasks_scope.map { |task| serialize_task(task) }
        }
      end

      # GET /api/v1/daily_tasks/:id
      def show
        render json: { daily_task: serialize_task(@task) }
      end

      # POST /api/v1/daily_tasks
      def create
        @task = DailyTask.new(create_params)
        @task.created_by = current_user
        @task.status_changed_by = current_user
        @task.status_changed_at = Time.current

        assign_next_position!

        if @task.save
          AuditLog.log(
            auditable: @task,
            action: "created",
            user: current_user,
            metadata: "Created daily task: #{@task.title}"
          )
          render json: { daily_task: serialize_task(@task) }, status: :created
        else
          render json: { error: @task.errors.full_messages.join(", ") }, status: :unprocessable_entity
        end
      end

      # PATCH /api/v1/daily_tasks/:id
      def update
        previous = snapshot(@task)

        ActiveRecord::Base.transaction do
          if @task.update(update_params)
            recalculate_position_if_date_changed!
            handle_status_change!
            log_update(previous, @task)
            render json: { daily_task: serialize_task(@task) }
          else
            render json: { error: @task.errors.full_messages.join(", ") }, status: :unprocessable_entity
          end
        end
      end

      # DELETE /api/v1/daily_tasks/:id
      def destroy
        task_id = @task.id
        task_title = @task.title
        @task.destroy!
        AuditLog.create!(
          auditable_type: "DailyTask",
          auditable_id: task_id,
          action: "deleted",
          user: current_user,
          metadata: "Deleted daily task: #{task_title}"
        )
        head :no_content
      end

      # POST /api/v1/daily_tasks/:id/complete
      def complete
        previous = snapshot(@task)

        @task.assign_attributes(
          status: "done",
          completed_at: Time.current,
          completed_by: current_user,
          status_changed_at: Time.current,
          status_changed_by: current_user
        )

        if @task.save
          log_update(previous, @task, metadata: "Marked task done")
          render json: { daily_task: serialize_task(@task) }
        else
          render json: { error: @task.errors.full_messages.join(", ") }, status: :unprocessable_entity
        end
      end

      # POST /api/v1/daily_tasks/:id/reopen
      def reopen
        previous = snapshot(@task)

        @task.assign_attributes(
          status: "not_started",
          completed_at: nil,
          completed_by: nil,
          status_changed_at: Time.current,
          status_changed_by: current_user
        )

        if @task.save
          log_update(previous, @task, metadata: "Reopened task")
          render json: { daily_task: serialize_task(@task) }
        else
          render json: { error: @task.errors.full_messages.join(", ") }, status: :unprocessable_entity
        end
      end

      # POST /api/v1/daily_tasks/reorder
      def reorder
        positions = params.require(:positions)
        return render json: { success: true } if positions.empty?

        ActiveRecord::Base.transaction do
          positions.each do |pos|
            DailyTask.where(id: pos[:id]).update_all(position: pos[:position])
          end

          AuditLog.create!(
            auditable_type: "DailyTask",
            auditable_id: positions.first[:id],
            action: "updated",
            user: current_user,
            metadata: "Reordered #{positions.size} daily task(s)"
          )
        end

        render json: { success: true }
      end

      # POST /api/v1/daily_tasks/bulk_create
      def bulk_create
        tasks_params = params.require(:daily_tasks)
        created_tasks = []

        ActiveRecord::Base.transaction do
          position_counters = {}
          tasks_params.each do |tp|
            task = DailyTask.new(tp.permit(
              :title, :task_date, :status, :priority, :form_service,
              :comments, :due_date, :client_id, :tax_return_id,
              :service_type_id, :assigned_to_id, :reviewed_by_id
            ))
            task.created_by = current_user
            task.status_changed_by = current_user
            task.status_changed_at = Time.current
            date_key = task.task_date.to_s
            position_counters[date_key] ||= DailyTask.for_date(task.task_date).maximum(:position) || -1
            position_counters[date_key] += 1
            task.position = position_counters[date_key]
            task.save!
            created_tasks << task
          end
        end

        created_tasks.each do |task|
          AuditLog.log(
            auditable: task,
            action: "created",
            user: current_user,
            metadata: "Created daily task: #{task.title}"
          )
        end

        render json: {
          daily_tasks: created_tasks.map { |task| serialize_task(task) }
        }, status: :created
      rescue ActiveRecord::RecordInvalid => e
        render json: { error: e.message }, status: :unprocessable_entity
      end

      # POST /api/v1/daily_tasks/preview_import
      def preview_import
        unless params[:file].present?
          return render json: { error: "No file uploaded" }, status: :bad_request
        end

        service = DailyTaskImportService.new(params[:file], user: current_user)
        result = service.preview
        render json: {
          rows: result[:rows],
          row_count: result[:rows].size,
          sheet_name: result[:sheet_name]
        }
      rescue DailyTaskImportService::ImportError => e
        render json: { error: e.message }, status: :unprocessable_entity
      rescue StandardError => e
        Rails.logger.error("Import preview failed: #{e.class} - #{e.message}")
        render json: { error: "Failed to parse file: #{e.message}" }, status: :unprocessable_entity
      end

      # POST /api/v1/daily_tasks/import_spreadsheet
      def import_spreadsheet
        task_date = Date.parse(params.require(:task_date))
        rows = params.require(:rows).map do |r|
          r.permit(:client, :form_service, :comments, :staff_id, :reviewed_by_id, :resolved_status).to_h
        end

        service = DailyTaskImportService.new(nil, user: current_user)
        result = service.import!(task_date: task_date, rows: rows)

        render json: {
          daily_tasks: result[:created].map { |t| serialize_task(t) },
          imported_count: result[:created].size
        }, status: :created
      rescue Date::Error
        render json: { error: "Invalid date format" }, status: :bad_request
      rescue ActionController::ParameterMissing => e
        render json: { error: e.message }, status: :bad_request
      rescue StandardError => e
        Rails.logger.error("Import failed: #{e.class} - #{e.message}")
        render json: { error: "Import failed: #{e.message}" }, status: :unprocessable_entity
      end

      # POST /api/v1/daily_tasks/copy_to_date
      def copy_to_date
        source_date = Date.parse(params.require(:source_date))
        target_date = Date.parse(params.require(:target_date))
        include_done = params[:include_done] == "true"

        if source_date == target_date
          return render json: { error: "Target date must differ from source date" }, status: :bad_request
        end

        source_tasks = DailyTask.for_date(source_date).ordered
        source_tasks = source_tasks.not_done unless include_done

        created_tasks = []
        ActiveRecord::Base.transaction do
          base_position = DailyTask.for_date(target_date).maximum(:position)&.to_i || -1
          source_tasks.each_with_index do |source, idx|
            task = source.dup
            task.task_date = target_date
            task.position = base_position + idx + 1
            task.completed_at = nil
            task.completed_by = nil
            # Intentionally preserves source task's status so staff can see
            # carry-over progress (e.g. "pending_info" items still need attention).
            task.status_changed_at = Time.current
            task.status_changed_by = current_user
            task.created_by = current_user
            task.save!
            created_tasks << task
          end
        end

        created_tasks.each do |task|
          AuditLog.log(
            auditable: task,
            action: "created",
            user: current_user,
            metadata: "Copied daily task from #{source_date}: #{task.title}"
          )
        end

        render json: {
          daily_tasks: created_tasks.map { |t| serialize_task(t) },
          copied_count: created_tasks.size
        }, status: :created
      rescue Date::Error
        render json: { error: "Invalid date format" }, status: :bad_request
      rescue ActionController::ParameterMissing => e
        render json: { error: e.message }, status: :bad_request
      end

      private

      def set_task
        @task = DailyTask.includes(
          :client, :tax_return, :service_type,
          :assigned_to, :reviewed_by, :created_by,
          :status_changed_by, :completed_by
        ).find(params[:id])
      end

      def filtered_tasks
        tasks = DailyTask.includes(
          :client, :tax_return, :service_type,
          :assigned_to, :reviewed_by, :created_by,
          :status_changed_by, :completed_by
        ).ordered

        tasks = tasks.for_date(params[:task_date]) if params[:task_date].present?
        tasks = tasks.where(status: params[:status]) if params[:status].present?
        tasks = tasks.where(assigned_to_id: params[:assigned_to_id]) if params[:assigned_to_id].present?
        tasks = tasks.where(client_id: params[:client_id]) if params[:client_id].present?
        tasks = tasks.where(priority: params[:priority]) if params[:priority].present?

        if params[:include_done] != "true" && params[:status].blank?
          tasks = tasks.not_done
        end

        tasks = tasks.limit(500) unless params[:task_date].present?

        tasks
      end

      def create_params
        params.require(:daily_task).permit(
          :title, :task_date, :status, :priority, :form_service,
          :comments, :due_date, :client_id, :tax_return_id,
          :service_type_id, :assigned_to_id, :reviewed_by_id
        )
      end

      def update_params
        params.require(:daily_task).permit(
          :title, :status, :priority, :form_service, :comments,
          :due_date, :client_id, :tax_return_id, :service_type_id,
          :assigned_to_id, :reviewed_by_id, :task_date
        )
      end

      def assign_next_position!
        max_pos = DailyTask.for_date(@task.task_date).maximum(:position) || -1
        @task.position = max_pos + 1
      end

      def handle_status_change!
        return unless @task.saved_change_to_status?

        @task.update_columns(
          status_changed_at: Time.current,
          status_changed_by_id: current_user.id
        )

        if @task.status.in?(DailyTask::DONE_STATUSES) && @task.completed_at.blank?
          @task.update_columns(
            completed_at: Time.current,
            completed_by_id: current_user.id
          )
        elsif !@task.status.in?(DailyTask::DONE_STATUSES) && @task.completed_at.present?
          @task.update_columns(completed_at: nil, completed_by_id: nil)
        end
      end

      def recalculate_position_if_date_changed!
        return unless @task.saved_change_to_task_date?

        max_pos = DailyTask.for_date(@task.task_date).where.not(id: @task.id).maximum(:position) || -1
        @task.update_columns(position: max_pos + 1)
      end

      def snapshot(task)
        {
          title: task.title,
          status: task.status,
          priority: task.priority,
          form_service: task.form_service,
          comments: task.comments,
          assigned_to_id: task.assigned_to_id,
          reviewed_by_id: task.reviewed_by_id,
          client_id: task.client_id,
          due_date: task.due_date&.iso8601,
          task_date: task.task_date.iso8601,
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

        return if changes.empty? && metadata.nil?

        AuditLog.log(
          auditable: task,
          action: "updated",
          user: current_user,
          changes_made: changes.presence,
          metadata: metadata || "Updated daily task: #{task.title}"
        )
      end

      def serialize_task(task)
        {
          id: task.id,
          title: task.title,
          task_date: task.task_date.iso8601,
          position: task.position,
          status: task.status,
          priority: task.priority,
          form_service: task.form_service,
          comments: task.comments,
          due_date: task.due_date&.iso8601,
          client: task.client ? {
            id: task.client.id,
            name: task.client.full_name
          } : nil,
          tax_return: task.tax_return ? {
            id: task.tax_return.id,
            tax_year: task.tax_return.tax_year,
            filing_status: task.tax_return.filing_status
          } : nil,
          service_type: task.service_type ? {
            id: task.service_type.id,
            name: task.service_type.name
          } : nil,
          assigned_to: task.assigned_to ? {
            id: task.assigned_to.id,
            name: task.assigned_to.full_name
          } : nil,
          reviewed_by: task.reviewed_by ? {
            id: task.reviewed_by.id,
            name: task.reviewed_by.full_name
          } : nil,
          created_by: task.created_by ? {
            id: task.created_by.id,
            name: task.created_by.full_name
          } : nil,
          status_changed_at: task.status_changed_at&.iso8601,
          status_changed_by: task.status_changed_by ? {
            id: task.status_changed_by.id,
            name: task.status_changed_by.full_name
          } : nil,
          completed_at: task.completed_at&.iso8601,
          completed_by: task.completed_by ? {
            id: task.completed_by.id,
            name: task.completed_by.full_name
          } : nil,
          created_at: task.created_at.iso8601,
          updated_at: task.updated_at.iso8601
        }
      end
    end
  end
end
