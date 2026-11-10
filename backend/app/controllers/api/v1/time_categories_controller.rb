# frozen_string_literal: true

module Api
  module V1
    class TimeCategoriesController < BaseController
      before_action :authenticate_user!
      before_action :require_staff!

      # GET /api/v1/time_categories
      # Returns active time categories for dropdown selection
      # Supervisors see all active categories (they log time for others); employees see only their assigned categories
      def index
        @categories = if current_user.can_manage_team_time?
          TimeCategory.active.order(:name)
        else
          current_user.assigned_time_categories.active.order(:name)
        end

        render json: {
          time_categories: @categories.map { |cat| serialize_category(cat) }
        }
      end

      private

      def serialize_category(category)
        {
          id: category.id,
          key: category.key,
          name: category.name,
          description: category.description
        }
      end
    end
  end
end
