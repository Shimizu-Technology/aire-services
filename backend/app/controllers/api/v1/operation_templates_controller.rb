# frozen_string_literal: true

module Api
  module V1
    class OperationTemplatesController < BaseController
      before_action :authenticate_user!
      before_action :require_admin!
      before_action :set_template, only: [ :update, :destroy ]

      # GET /api/v1/operation_templates
      def index
        templates = OperationTemplate.includes(:operation_template_tasks).ordered
        templates = templates.active unless include_inactive?

        render json: {
          operation_templates: templates.map { |template| serialize_template(template) }
        }
      end

      # POST /api/v1/operation_templates
      def create
        template = OperationTemplate.new(template_params.merge(created_by: current_user))
        if template.save
          render json: { operation_template: serialize_template(template) }, status: :created
        else
          render json: { error: template.errors.full_messages.join(", ") }, status: :unprocessable_entity
        end
      end

      # PATCH /api/v1/operation_templates/:id
      def update
        if @template.update(template_params)
          render json: { operation_template: serialize_template(@template) }
        else
          render json: { error: @template.errors.full_messages.join(", ") }, status: :unprocessable_entity
        end
      end

      # DELETE /api/v1/operation_templates/:id
      def destroy
        if @template.update(is_active: false)
          head :no_content
        else
          render json: { error: @template.errors.full_messages.join(", ") }, status: :unprocessable_entity
        end
      end

      private

      def set_template
        @template = OperationTemplate.find(params[:id])
      end

      def include_inactive?
        ActiveModel::Type::Boolean.new.cast(params[:include_inactive])
      end

      def template_params
        params.require(:operation_template).permit(
          :name,
          :description,
          :category,
          :recurrence_type,
          :recurrence_interval,
          :recurrence_anchor,
          :auto_generate,
          :is_active
        )
      end

      def serialize_template(template)
        {
          id: template.id,
          name: template.name,
          description: template.description,
          category: template.category,
          recurrence_type: template.recurrence_type,
          recurrence_interval: template.recurrence_interval,
          recurrence_anchor: template.recurrence_anchor,
          auto_generate: template.auto_generate,
          is_active: template.is_active,
          created_by_id: template.created_by_id,
          created_at: template.created_at.iso8601,
          updated_at: template.updated_at.iso8601,
          tasks: template.operation_template_tasks
                         .yield_self { |scope| include_inactive? ? scope : scope.active }
                         .ordered
                         .map { |task| serialize_task(task) }
        }
      end

      def serialize_task(task)
        {
          id: task.id,
          title: task.title,
          description: task.description,
          position: task.position,
          default_assignee_id: task.default_assignee_id,
          due_offset_value: task.due_offset_value,
          due_offset_unit: task.due_offset_unit,
          due_offset_from: task.due_offset_from,
          evidence_required: task.evidence_required,
          dependency_template_task_ids: task.dependency_template_task_ids || [],
          is_active: task.is_active
        }
      end
    end
  end
end
