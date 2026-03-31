# frozen_string_literal: true

module Api
  module V1
    module Admin
      class ServiceTypesController < BaseController
        before_action :authenticate_user!
        before_action :require_admin!
        before_action :set_service_type, only: [:show, :update, :destroy]

        # GET /api/v1/admin/service_types
        def index
          service_types = ServiceType.ordered.includes(:service_tasks)

          render json: {
            service_types: service_types.map { |st| serialize_service_type(st, include_tasks: true) }
          }
        end

        # GET /api/v1/admin/service_types/:id
        def show
          render json: {
            service_type: serialize_service_type(@service_type, include_tasks: true)
          }
        end

        # POST /api/v1/admin/service_types
        def create
          @service_type = ServiceType.new(service_type_params)

          if @service_type.save
            render json: {
              service_type: serialize_service_type(@service_type, include_tasks: true)
            }, status: :created
          else
            render json: { errors: @service_type.errors.full_messages }, status: :unprocessable_entity
          end
        end

        # PATCH /api/v1/admin/service_types/:id
        def update
          if @service_type.update(service_type_params)
            render json: {
              service_type: serialize_service_type(@service_type, include_tasks: true)
            }
          else
            render json: { errors: @service_type.errors.full_messages }, status: :unprocessable_entity
          end
        end

        # DELETE /api/v1/admin/service_types/:id
        def destroy
          # Soft delete by setting is_active to false
          @service_type.update!(is_active: false)
          render json: { message: "Service type deactivated" }
        end

        # POST /api/v1/admin/service_types/reorder
        def reorder
          positions = params[:positions] # Array of { id: X, position: Y }

          ActiveRecord::Base.transaction do
            positions.each do |pos|
              ServiceType.where(id: pos[:id]).update_all(position: pos[:position])
            end
          end

          render json: { message: "Positions updated" }
        end

        private

        def set_service_type
          @service_type = ServiceType.find(params[:id])
        end

        def service_type_params
          params.require(:service_type).permit(:name, :description, :color, :is_active, :position)
        end

        def serialize_service_type(service_type, include_tasks: false)
          data = {
            id: service_type.id,
            name: service_type.name,
            description: service_type.description,
            color: service_type.color,
            is_active: service_type.is_active,
            position: service_type.position,
            created_at: service_type.created_at,
            updated_at: service_type.updated_at
          }

          if include_tasks
            data[:tasks] = service_type.service_tasks.ordered.map do |task|
              {
                id: task.id,
                name: task.name,
                description: task.description,
                is_active: task.is_active,
                position: task.position
              }
            end
          end

          data
        end
      end
    end
  end
end
