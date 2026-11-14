# frozen_string_literal: true

module Api
  module V1
    module Admin
      # The Team page's My Pay switches: "On for everyone" and each person's
      # "My Pay on". Owners and admins only; every change is audited.
      class MyPayAccessController < BaseController
        rescue_from AdminPersonEdit::Conflict do |error|
          render json: { error: error.message }, status: :conflict
        end

        before_action :authenticate_user!
        before_action -> { require_capability!(:manage_my_pay_access) }

        def show
          render json: serialized_access
        end

        def update
          return render json: { error: "Set enabled_for_all to true or false" }, status: :unprocessable_entity unless boolean?(params[:enabled_for_all])

          MyPayAccess.set_for_all!(enabled: cast(params[:enabled_for_all]), actor: current_user)
          Setting.clear_cache!
          render json: serialized_access
        end

        def update_user
          return render json: { error: "Set enabled to true or false" }, status: :unprocessable_entity unless boolean?(params[:enabled])

          user = User.staff.find_by(id: params[:user_id])
          return render json: { error: "User not found" }, status: :not_found unless user

          MyPayAccess.set_for_user!(user: user, enabled: cast(params[:enabled]), actor: current_user, expected_version: params.fetch(:admin_edit_version, :unchecked))
          render json: { user_id: user.id, my_pay_enabled: user.my_pay_enabled?, my_pay_active: Setting.my_pay_enabled_for?(user), admin_edit_version: user.admin_edit_version }
        end

        private

        def serialized_access
          { enabled_for_all: Setting.my_pay_enabled_for_all?, enabled_user_ids: User.staff.where(my_pay_enabled: true).order(:id).pluck(:id) }
        end

        def boolean?(value)
          [ true, false, "true", "false" ].include?(value)
        end

        def cast(value)
          ActiveModel::Type::Boolean.new.cast(value)
        end
      end
    end
  end
end
