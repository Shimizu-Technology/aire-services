# frozen_string_literal: true

module Api
  module V1
    module Admin
      class TimeCategoriesController < BaseController
        before_action :authenticate_user!
        before_action :require_admin!
        before_action :set_category, only: [ :show, :update, :destroy ]

        # GET /api/v1/admin/time_categories
        def index
          @categories = TimeCategory.with_usage_counts.order(:name)

          # Filter by active status
          if params[:active].present?
            @categories = params[:active] == "true" ? @categories.active : @categories.where(is_active: false)
          end

          render json: {
            time_categories: @categories.map { |cat| serialize_category(cat) }
          }
        end

        # GET /api/v1/admin/time_categories/:id
        def show
          render json: { time_category: serialize_category(@category) }
        end

        # POST /api/v1/admin/time_categories
        def create
          @category = TimeCategory.new(category_params)

          if @category.save
            render json: { time_category: serialize_category(@category) }, status: :created
          else
            render json: { error: @category.errors.full_messages.join(", ") }, status: :unprocessable_entity
          end
        end

        # PATCH /api/v1/admin/time_categories/:id
        def update
          if @category.update(category_params)
            render json: { time_category: serialize_category(@category) }
          else
            render json: { error: @category.errors.full_messages.join(", ") }, status: :unprocessable_entity
          end
        end

        # DELETE /api/v1/admin/time_categories/:id
        def destroy
          unless @category.deletable?
            return render json: {
              error: "This category already has saved time history or pay-rate data. Deactivate it instead of deleting it."
            }, status: :unprocessable_entity
          end

          @category.destroy!
          head :no_content
        rescue ActiveRecord::RecordNotDestroyed
          render json: {
            error: "This category already has saved time history or pay-rate data. Deactivate it instead of deleting it."
          }, status: :unprocessable_entity
        end

        private

        def set_category
          @category = TimeCategory.find(params[:id])
        rescue ActiveRecord::RecordNotFound
          render json: { error: "Time category not found" }, status: :not_found
        end

        def category_params
          params.require(:time_category).permit(:name, :key, :description, :is_active, :hourly_rate_cents)
        end

        def serialize_category(category)
          {
            id: category.id,
            key: category.key,
            name: category.name,
            description: category.description,
            is_active: category.is_active,
            hourly_rate_cents: category.hourly_rate_cents,
            hourly_rate: category.hourly_rate,
            time_entries_count: category.time_entries_count,
            employee_pay_rates_count: category.employee_pay_rates_count,
            deletable: category.deletable?,
            created_at: category.created_at.iso8601,
            updated_at: category.updated_at.iso8601
          }
        end
      end
    end
  end
end
