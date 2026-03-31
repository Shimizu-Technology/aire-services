# frozen_string_literal: true

module Api
  module V1
    module Admin
      class ServiceTasksController < BaseController
        before_action :authenticate_user!
        before_action :require_admin!
        before_action :set_service_type
        before_action :set_service_task, only: [:show, :update, :destroy]

        # GET /api/v1/admin/service_types/:service_type_id/tasks
        def index
          tasks = @service_type.service_tasks.ordered

          render json: {
            tasks: tasks.map { |task| serialize_task(task) }
          }
        end

        # GET /api/v1/admin/service_types/:service_type_id/tasks/:id
        def show
          render json: {
            task: serialize_task(@service_task)
          }
        end

        # POST /api/v1/admin/service_types/:service_type_id/tasks
        def create
          @service_task = @service_type.service_tasks.build(service_task_params)

          if @service_task.save
            render json: {
              task: serialize_task(@service_task)
            }, status: :created
          else
            render json: { errors: @service_task.errors.full_messages }, status: :unprocessable_entity
          end
        end

        # PATCH /api/v1/admin/service_types/:service_type_id/tasks/:id
        def update
          if @service_task.update(service_task_params)
            render json: {
              task: serialize_task(@service_task)
            }
          else
            render json: { errors: @service_task.errors.full_messages }, status: :unprocessable_entity
          end
        end

        # DELETE /api/v1/admin/service_types/:service_type_id/tasks/:id
        def destroy
          # Soft delete by setting is_active to false
          @service_task.update!(is_active: false)
          render json: { message: "Task deactivated" }
        end

        # POST /api/v1/admin/service_types/:service_type_id/tasks/reorder
        def reorder
          positions = params[:positions] # Array of { id: X, position: Y }

          ActiveRecord::Base.transaction do
            positions.each do |pos|
              @service_type.service_tasks.where(id: pos[:id]).update_all(position: pos[:position])
            end
          end

          render json: { message: "Positions updated" }
        end

        private

        def set_service_type
          @service_type = ServiceType.find(params[:service_type_id])
        end

        def set_service_task
          @service_task = @service_type.service_tasks.find(params[:id])
        end

        def service_task_params
          params.require(:service_task).permit(:name, :description, :is_active, :position)
        end

        def serialize_task(task)
          {
            id: task.id,
            service_type_id: task.service_type_id,
            name: task.name,
            description: task.description,
            is_active: task.is_active,
            position: task.position,
            created_at: task.created_at,
            updated_at: task.updated_at
          }
        end
      end
    end
  end
end
