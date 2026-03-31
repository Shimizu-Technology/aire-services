# frozen_string_literal: true

module Api
  module V1
    class ServiceTypesController < BaseController
      before_action :authenticate_user!

      # GET /api/v1/service_types
      # Returns active service types for dropdowns, with their tasks
      def index
        service_types = ServiceType.active.ordered.includes(:service_tasks)

        render json: {
          service_types: service_types.map { |st| serialize_service_type(st) }
        }
      end

      private

      def serialize_service_type(service_type)
        {
          id: service_type.id,
          name: service_type.name,
          description: service_type.description,
          color: service_type.color,
          tasks: service_type.service_tasks.active.ordered.map do |task|
            {
              id: task.id,
              name: task.name,
              description: task.description
            }
          end
        }
      end
    end
  end
end
