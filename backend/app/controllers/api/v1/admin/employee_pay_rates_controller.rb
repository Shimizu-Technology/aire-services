# frozen_string_literal: true

module Api
  module V1
    module Admin
      class EmployeePayRatesController < Api::V1::BaseController
        before_action :authenticate_user!
        before_action :require_admin!

        # GET /api/v1/admin/employee_pay_rates
        # Optional filter: ?user_id=123
        def index
          rates = EmployeePayRate.includes(:user, :time_category).order(:user_id, :time_category_id)
          rates = rates.where(user_id: params[:user_id]) if params[:user_id].present?

          render json: {
            employee_pay_rates: rates.map { |r| serialize_rate(r) }
          }
        end

        # POST /api/v1/admin/employee_pay_rates
        def create
          rate = EmployeePayRate.new(rate_params)

          if rate.save
            render json: { employee_pay_rate: serialize_rate(rate) }, status: :created
          else
            render json: { error: rate.errors.full_messages.join(", ") }, status: :unprocessable_entity
          end
        end

        # PATCH /api/v1/admin/employee_pay_rates/:id
        def update
          rate = EmployeePayRate.find(params[:id])

          if rate.update(rate_params)
            render json: { employee_pay_rate: serialize_rate(rate) }
          else
            render json: { error: rate.errors.full_messages.join(", ") }, status: :unprocessable_entity
          end
        end

        # DELETE /api/v1/admin/employee_pay_rates/:id
        def destroy
          rate = EmployeePayRate.find(params[:id])
          rate.destroy
          head :no_content
        end

        # GET /api/v1/admin/employee_pay_rates/for_user/:user_id
        # Returns effective rates (override or category default) for all active categories
        def for_user
          user = User.find(params[:user_id])
          categories = TimeCategory.active.order(:name)

          effective_rates = categories.map do |cat|
            override = EmployeePayRate.find_by(user_id: user.id, time_category_id: cat.id)
            {
              time_category_id: cat.id,
              time_category_name: cat.name,
              time_category_key: cat.key,
              default_rate_cents: cat.hourly_rate_cents,
              default_rate: cat.hourly_rate,
              override_rate_cents: override&.hourly_rate_cents,
              override_rate: override&.hourly_rate,
              effective_rate_cents: override&.hourly_rate_cents || cat.hourly_rate_cents,
              effective_rate: override ? override.hourly_rate : cat.hourly_rate,
              override_id: override&.id
            }
          end

          render json: {
            user: { id: user.id, full_name: user.full_name, display_name: user.display_name },
            effective_rates: effective_rates
          }
        end

        private

        def rate_params
          params.require(:employee_pay_rate).permit(:user_id, :time_category_id, :hourly_rate_cents)
        end

        def serialize_rate(rate)
          {
            id: rate.id,
            user_id: rate.user_id,
            user_name: rate.user.full_name,
            time_category_id: rate.time_category_id,
            time_category_name: rate.time_category.name,
            time_category_key: rate.time_category.key,
            hourly_rate_cents: rate.hourly_rate_cents,
            hourly_rate: rate.hourly_rate,
            default_rate_cents: rate.time_category.hourly_rate_cents,
            default_rate: rate.time_category.hourly_rate,
            created_at: rate.created_at.iso8601,
            updated_at: rate.updated_at.iso8601
          }
        end
      end
    end
  end
end
