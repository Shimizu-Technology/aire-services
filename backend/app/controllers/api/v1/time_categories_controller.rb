# frozen_string_literal: true

module Api
  module V1
    class TimeCategoriesController < BaseController
      before_action :authenticate_user!
      before_action :require_staff!

      # GET /api/v1/time_categories
      # Returns active time categories for dropdown selection
      # Admins see all active categories; employees see only their assigned categories
      def index
        @categories = if current_user.admin?
          TimeCategory.active.order(:name)
        else
          assigned = current_user.assigned_time_categories.active.order(:name)
          assigned.any? ? assigned : TimeCategory.active.order(:name)
        end

        render json: {
          time_categories: @categories.map { |cat| serialize_category(cat) }
        }
      end

      private

      def serialize_category(category)
        base = {
          id: category.id,
          key: category.key,
          name: category.name,
          description: category.description
        }
        if current_user.admin?
          base[:hourly_rate_cents] = category.hourly_rate_cents
          base[:hourly_rate] = category.hourly_rate
        end
        base
      end
    end
  end
end
