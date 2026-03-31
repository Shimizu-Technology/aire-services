# frozen_string_literal: true

module Api
  module V1
    class OperationTemplateTasksController < BaseController
      before_action :authenticate_user!
      before_action :require_admin!
      before_action :set_template, only: [ :index, :create, :reorder ]
      before_action :set_task, only: [ :update, :destroy ]

      # GET /api/v1/operation_templates/:operation_template_id/tasks
      def index
        tasks = @template.operation_template_tasks.ordered
        tasks = tasks.active unless include_inactive?

        render json: {
          tasks: tasks.map { |task| serialize_task(task) }
        }
      end

      # POST /api/v1/operation_templates/:operation_template_id/tasks
      def create
        task = @template.operation_template_tasks.new(task_params)
        if task.save
          render json: { task: serialize_task(task) }, status: :created
        else
          render json: { error: task.errors.full_messages.join(", ") }, status: :unprocessable_entity
        end
      end

      # POST /api/v1/operation_templates/:operation_template_id/tasks/reorder
      def reorder
        positions = params[:positions]
        unless positions.is_a?(Array)
          return render json: { error: "positions must be an array" }, status: :unprocessable_entity
        end

        task_ids = positions.map { |item| item[:id] || item["id"] }.compact.map(&:to_i)
        valid_ids = @template.operation_template_tasks.where(id: task_ids).pluck(:id)
        if valid_ids.length != task_ids.uniq.length
          return render json: { error: "one or more tasks are invalid for this template" }, status: :unprocessable_entity
        end

        ActiveRecord::Base.transaction do
          positions.each_with_index do |item, index|
            id = (item[:id] || item["id"]).to_i
            position = item[:position] || item["position"] || (index + 1)
            @template.operation_template_tasks.where(id: id).update_all(position: position.to_i)
          end
        end

        tasks = @template.operation_template_tasks.ordered
        render json: { tasks: tasks.map { |task| serialize_task(task) } }
      end

      # PATCH /api/v1/operation_template_tasks/:id
      def update
        if @task.update(task_params)
          render json: { task: serialize_task(@task) }
        else
          render json: { error: @task.errors.full_messages.join(", ") }, status: :unprocessable_entity
        end
      end

      # DELETE /api/v1/operation_template_tasks/:id
      def destroy
        if @task.update(is_active: false)
          head :no_content
        else
          render json: { error: @task.errors.full_messages.join(", ") }, status: :unprocessable_entity
        end
      end

      private

      def set_template
        @template = OperationTemplate.find(params[:operation_template_id])
      end

      def set_task
        # Admin-only controller (require_admin!), so admin can access any task
        # Join through template to ensure task belongs to a valid, active template
        @task = OperationTemplateTask
          .joins(:operation_template)
          .where(operation_templates: { is_active: true })
          .find(params[:id])
      end

      def include_inactive?
        ActiveModel::Type::Boolean.new.cast(params[:include_inactive])
      end

      def task_params
        params.require(:task).permit(
          :title,
          :description,
          :position,
          :default_assignee_id,
          :due_offset_value,
          :due_offset_unit,
          :due_offset_from,
          :evidence_required,
          :is_active,
          dependency_template_task_ids: []
        )
      end

      def serialize_task(task)
        {
          id: task.id,
          operation_template_id: task.operation_template_id,
          title: task.title,
          description: task.description,
          position: task.position,
          default_assignee_id: task.default_assignee_id,
          due_offset_value: task.due_offset_value,
          due_offset_unit: task.due_offset_unit,
          due_offset_from: task.due_offset_from,
          evidence_required: task.evidence_required,
          dependency_template_task_ids: task.dependency_template_task_ids || [],
          is_active: task.is_active,
          created_at: task.created_at.iso8601,
          updated_at: task.updated_at.iso8601
        }
      end
    end
  end
end
