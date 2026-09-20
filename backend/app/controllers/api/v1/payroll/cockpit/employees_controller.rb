# frozen_string_literal: true

module Api
  module V1
    module Payroll
      module Cockpit
        class EmployeesController < BaseController
          def index
            scope = User.staff
              .includes(:assigned_time_categories, :user_approval_groups)
              .order(:last_name, :first_name, :id)
            if params[:employee_id].present?
              begin
                employee_id = Integer(params[:employee_id].to_s, 10)
              rescue ArgumentError
                return render json: { error: "employee_id must be a positive integer" }, status: :unprocessable_entity
              end
              return render json: { error: "employee_id must be positive" }, status: :unprocessable_entity unless employee_id.positive?

              scope = scope.where(id: employee_id)
            end
            active_filter = params[:active].presence
            if active_filter
              unless active_filter.in?(%w[true false])
                return render json: { error: "active must be true or false" }, status: :unprocessable_entity
              end

              scope = scope.where(is_active: active_filter == "true")
            end
            page = pagination_for(scope)

            render json: {
              employees: page.fetch(:records).map { |user| serialize_employee(user) },
              pagination: page.fetch(:metadata)
            }
          end

          private

          def serialize_employee(user)
            {
              id: user.id.to_s,
              payroll_integration_id: user.payroll_integration_uuid,
              first_name: user.first_name,
              last_name: user.last_name,
              full_name: user.full_name,
              email: user.email,
              active: user.is_active?,
              role: user.role,
              time_tracking_enabled: user.time_tracking_enabled?,
              approval_groups: user.approval_group_keys.map do |key|
                { key: key, label: Setting.approval_group_label_for(key) }
              end,
              time_categories: user.assigned_time_categories.select(&:is_active?).map do |category|
                { id: category.id.to_s, key: category.key, name: category.name }
              end
            }
          end
        end
      end
    end
  end
end
