# frozen_string_literal: true

module Api
  module V1
    module Admin
      class UsersController < BaseController
        before_action :authenticate_user!
        before_action :require_admin!
        before_action :set_user, only: [ :show, :update, :destroy, :resend_invite, :reset_kiosk_pin ]

        def index
          @users = User.includes(user_time_categories: :time_category).order(created_at: :desc)

          if params[:role].present?
            @users = @users.where(role: params[:role])
          end

          pending_scope = @users.where("clerk_id IS NULL OR clerk_id LIKE 'pending_%'")

          if params[:status] == "active"
            @users = @users.where(is_active: true).where.not(id: pending_scope.select(:id))
          elsif params[:status] == "inactive"
            @users = @users.where(is_active: false)
          elsif params[:status] == "pending"
            @users = pending_scope.where(is_active: true)
          end

          render json: {
            users: @users.map { |user| serialize_user(user) }
          }
        end

        def show
          render json: { user: serialize_user(@user) }
        end

        def create
          email = params[:email]&.downcase&.strip.presence
          first_name = params[:first_name]&.strip
          last_name = params[:last_name]&.strip
          role = params[:role] || "employee"
          approval_group = normalized_approval_group(params[:approval_group])
          kiosk_only_user = email.blank?

          if kiosk_only_user && first_name.blank?
            return render json: { error: "First name is required" }, status: :unprocessable_entity
          end

          unless %w[admin employee].include?(role)
            return render json: { error: "Role must be admin or employee" }, status: :unprocessable_entity
          end

          unless valid_approval_group?(approval_group)
            return render json: { error: approval_group_error_message }, status: :unprocessable_entity
          end

          send_invitation =
            if params.key?(:send_invitation)
              ActiveModel::Type::Boolean.new.cast(params[:send_invitation])
            else
              email.present?
            end

          if send_invitation && email.blank?
            return render json: { error: "Email is required when sending an invitation" }, status: :unprocessable_entity
          end

          if email.present?
            unless email.match?(/\A[^@\s]+@[^@\s]+\.[^@\s]+\z/)
              return render json: { error: "Invalid email format" }, status: :unprocessable_entity
            end

            if User.exists?([ "LOWER(email) = ?", email ])
              return render json: { error: "A user with this email already exists" }, status: :unprocessable_entity
            end
          end

          @user = User.new(
            email: email,
            first_name: kiosk_only_user ? first_name : nil,
            last_name: kiosk_only_user ? last_name.presence : nil,
            role: role,
            approval_group: approval_group,
            clerk_id: "pending_#{SecureRandom.hex(8)}",
            is_active: true
          )

          if @user.save
            sync_time_categories(@user) if params[:time_category_ids].present?
            email_sent = send_invitation ? send_invitation_email(@user) : false

            render json: { user: serialize_user(@user), invitation_email_sent: email_sent }, status: :created
          else
            render json: { error: @user.errors.full_messages.join(", ") }, status: :unprocessable_entity
          end
        end

        def update
          if @user.id == current_user.id && params[:role].present? && params[:role] != current_user.role
            return render json: { error: "You cannot change your own role" }, status: :unprocessable_entity
          end

          payload = normalized_update_params
          return if performed?

          permitted = payload.fetch(:local_attributes)
          clerk_attributes = payload.fetch(:clerk_attributes)
          previous_state = snapshot_local_user_state(@user) if clerk_attributes.present?

          begin
            ActiveRecord::Base.transaction do
              @user.assign_attributes(permitted)
              @user.save!
              sync_time_categories(@user) if params.key?(:time_category_ids)
            end
          rescue ActiveRecord::RecordInvalid => e
            return render json: { error: e.record.errors.full_messages.join(", ") }, status: :unprocessable_entity
          end

          if clerk_attributes.present?
            begin
              ClerkUserService.update_user!(clerk_user_id: @user.clerk_id, **clerk_attributes)
            rescue ClerkUserService::Error => e
              begin
                restore_local_user_state!(@user, previous_state)
              rescue StandardError => rollback_error
                Rails.logger.error(
                  "Failed to roll back local user changes after Clerk sync error for user #{@user.id}: #{rollback_error.message}"
                )
                return render json: { error: "Clerk sync failed after saving local changes, and automatic rollback could not be completed. Manual intervention is required." }, status: :internal_server_error
              end

              return render json: { error: e.message }, status: :unprocessable_entity
            end
          end

          render json: { user: serialize_user(@user.reload) }
        end

        def destroy
          if @user.id == current_user.id
            return render json: { error: "You cannot delete your own account" }, status: :unprocessable_entity
          end

          @user.destroy
          head :no_content
        end

        def resend_invite
          unless @user.clerk_id.blank? || @user.clerk_id.start_with?("pending_")
            return render json: { error: "This user has already activated their account" }, status: :unprocessable_entity
          end

          cache_key = "resend_invite_cooldown:#{@user.id}"
          unless Rails.cache.write(cache_key, true, expires_in: 1.minute, unless_exist: true)
            return render json: { error: "Invitation was already sent recently. Please wait a minute before resending." }, status: :too_many_requests
          end

          email_sent = send_invitation_email(@user)

          unless email_sent
            Rails.cache.delete(cache_key)
            return render json: { error: "Failed to send invitation email. Please check email configuration." }, status: :unprocessable_entity
          end

          render json: { message: "Invitation email resent to #{@user.email}" }
        end

        def reset_kiosk_pin
          return render json: { error: "Kiosk PINs are only available for staff users" }, status: :unprocessable_entity unless @user.staff?

          pin = params[:pin].presence || format("%06d", SecureRandom.random_number(1_000_000))

          @user.skip_kiosk_pin_presence_validation = true
          @user.rotate_kiosk_pin!(pin)

          render json: {
            user: serialize_user(@user.reload),
            kiosk_pin: pin,
            message: "Kiosk PIN reset for #{@user.full_name}"
          }
        rescue ActiveRecord::RecordInvalid => e
          messages = e.record.errors.map { |err| err.attribute == :kiosk_pin_lookup_hash && err.type == :taken ? err.message : err.full_message }
          render json: { error: messages.join(", ") }, status: :unprocessable_entity
        end

        private

        def set_user
          @user = User.find(params[:id])
        rescue ActiveRecord::RecordNotFound
          render json: { error: "User not found" }, status: :not_found
        end

        def serialize_user(user)
          utcs = user.user_time_categories.includes(:time_category)
          {
            id: user.id,
            email: user.email,
            first_name: user.first_name,
            last_name: user.last_name,
            display_name: user.display_name,
            full_name: user.full_name,
            role: user.role,
            approval_group: user.approval_group,
            approval_group_label: user.approval_group_label,
            is_active: user.is_active,
            is_pending: user.pending_invite?,
            uses_clerk_profile: user.uses_clerk_profile?,
            public_team_enabled: user.public_team_enabled,
            public_team_name: user.public_team_name,
            public_team_title: user.public_team_title,
            public_team_sort_order: user.public_team_sort_order,
            kiosk_enabled: user.kiosk_enabled,
            kiosk_pin_configured: user.kiosk_pin_configured?,
            kiosk_pin_last_rotated_at: user.kiosk_pin_last_rotated_at&.iso8601,
            kiosk_locked_until: user.kiosk_locked_until&.iso8601,
            time_category_ids: utcs.map(&:time_category_id),
            time_categories: utcs.map { |utc| serialize_user_time_category(utc) },
            created_at: user.created_at.iso8601,
            updated_at: user.updated_at.iso8601
          }
        end

        def serialize_user_time_category(utc)
          {
            id: utc.time_category.id,
            name: utc.time_category.name,
            key: utc.time_category.key,
            hourly_rate_cents: utc.effective_hourly_rate_cents,
            hourly_rate: utc.effective_hourly_rate,
            override_rate_cents: utc.hourly_rate_cents
          }
        end

        def sync_time_categories(user)
          desired_ids = Array(params[:time_category_ids]).map(&:to_i).uniq
          overrides = params[:time_category_rate_overrides] || {}

          ActiveRecord::Base.transaction do
            user.user_time_categories.where.not(time_category_id: desired_ids).destroy_all

            desired_ids.each do |cat_id|
              utc = user.user_time_categories.find_or_initialize_by(time_category_id: cat_id)
              override = overrides[cat_id.to_s]
              utc.hourly_rate_cents = override.present? ? override.to_i : nil
              utc.save!
            end
          end
        end

        def snapshot_local_user_state(user)
          {
            attributes: user.attributes.slice(
              "email",
              "first_name",
              "last_name",
              "role",
              "approval_group",
              "is_active",
              "public_team_enabled",
              "public_team_name",
              "public_team_title",
              "public_team_sort_order"
            ),
            time_categories: user.user_time_categories.pluck(:time_category_id, :hourly_rate_cents)
          }
        end

        def restore_local_user_state!(user, snapshot)
          ActiveRecord::Base.transaction do
            user.reload
            user.update_columns(snapshot.fetch(:attributes).merge("updated_at" => Time.current))
            restore_user_time_categories!(user, snapshot.fetch(:time_categories))
          end
        end

        def restore_user_time_categories!(user, time_categories)
          desired_ids = time_categories.map(&:first)
          user.user_time_categories.where.not(time_category_id: desired_ids).destroy_all

          time_categories.each do |time_category_id, hourly_rate_cents|
            assignment = user.user_time_categories.find_or_initialize_by(time_category_id: time_category_id)
            assignment.hourly_rate_cents = hourly_rate_cents
            assignment.save!
          end
        end

        def send_invitation_email(user)
          sent = EmailService.send_invitation_email(user: user, invited_by: current_user)
          if sent
            Rails.logger.info "Invitation email sent to #{user.email}"
          else
            Rails.logger.warn "Invitation email could not be sent to #{user.email}"
          end
          sent
        end

        def normalized_approval_group(value)
          return nil if value.nil?

          normalized = value.to_s.strip.presence
          return nil if normalized.blank? || normalized == "unassigned"

          normalized
        end

        def valid_approval_group?(value)
          value.nil? || Setting.approval_group_keys.include?(value)
        end

        def normalized_update_params
          permitted = {}
          uses_clerk_profile = @user.uses_clerk_profile?
          active_clerk_user = uses_clerk_profile && !@user.pending_invite?
          clerk_attributes = {}

          if params[:role].present?
            unless %w[admin employee].include?(params[:role])
              render json: { error: "Role must be admin or employee" }, status: :unprocessable_entity
              return { local_attributes: {}, clerk_attributes: {} }
            end

            permitted[:role] = params[:role]
          end

          if params.key?(:first_name) || params.key?(:last_name)
            if uses_clerk_profile && !active_clerk_user
              render json: { error: "Pending Clerk invites will pull names from Clerk after first sign-in" }, status: :unprocessable_entity
              return { local_attributes: {}, clerk_attributes: {} }
            end
          end

          if params.key?(:first_name)
            first_name = params[:first_name].to_s.strip
            if first_name.blank?
              render json: { error: "First name is required" }, status: :unprocessable_entity
              return { local_attributes: {}, clerk_attributes: {} }
            end

            if active_clerk_user
              permitted[:first_name] = first_name
              clerk_attributes[:first_name] = first_name if first_name != @user.first_name.to_s
            else
              permitted[:first_name] = first_name
            end
          end

          if params.key?(:last_name)
            last_name = params[:last_name].to_s.strip.presence
            if active_clerk_user
              permitted[:last_name] = last_name
              clerk_attributes[:last_name] = last_name if last_name != @user.last_name.presence
            else
              permitted[:last_name] = last_name
            end
          end

          if params.key?(:email)
            email = params[:email].to_s.strip.downcase.presence

            if uses_clerk_profile
              if email.blank?
                render json: { error: "Clerk-managed users must keep an email address" }, status: :unprocessable_entity
                return { local_attributes: {}, clerk_attributes: {} }
              end

              if active_clerk_user
                if email != @user.email&.downcase
                  render json: { error: "Activated Clerk users must update their email from Clerk" }, status: :unprocessable_entity
                  return { local_attributes: {}, clerk_attributes: {} }
                end
              else
                permitted[:email] = email
              end
            elsif email.present?
              render json: { error: "Kiosk-only users cannot be converted to email sign-in from this form" }, status: :unprocessable_entity
              return { local_attributes: {}, clerk_attributes: {} }
            end

            if email.present? && !email.match?(/\A[^@\s]+@[^@\s]+\.[^@\s]+\z/)
              render json: { error: "Invalid email format" }, status: :unprocessable_entity
              return { local_attributes: {}, clerk_attributes: {} }
            end

            if email.present? && User.where.not(id: @user.id).exists?([ "LOWER(email) = ?", email ])
              render json: { error: "A user with this email already exists" }, status: :unprocessable_entity
              return { local_attributes: {}, clerk_attributes: {} }
            end
          end

          if params.key?(:approval_group)
            approval_group = normalized_approval_group(params[:approval_group])
            unless valid_approval_group?(approval_group)
              render json: { error: approval_group_error_message }, status: :unprocessable_entity
              return { local_attributes: {}, clerk_attributes: {} }
            end

            permitted[:approval_group] = approval_group
          end

          if params.key?(:is_active)
            is_active = ActiveModel::Type::Boolean.new.cast(params[:is_active])

            if !is_active && @user.id == current_user.id
              render json: { error: "You cannot deactivate your own account" }, status: :unprocessable_entity
              return { local_attributes: {}, clerk_attributes: {} }
            end

            permitted[:is_active] = is_active
          end

          if params.key?(:public_team_enabled)
            permitted[:public_team_enabled] = ActiveModel::Type::Boolean.new.cast(params[:public_team_enabled])
          end

          if params.key?(:public_team_name)
            permitted[:public_team_name] = params[:public_team_name].to_s.strip.presence
          end

          if params.key?(:public_team_title)
            permitted[:public_team_title] = params[:public_team_title].to_s.strip.presence
          end

          if params.key?(:public_team_sort_order)
            begin
              sort_order = Integer(params[:public_team_sort_order])
              permitted[:public_team_sort_order] = sort_order
            rescue ArgumentError, TypeError
              render json: { error: "Public team sort order must be a whole number" }, status: :unprocessable_entity
              return { local_attributes: {}, clerk_attributes: {} }
            end
          end

          { local_attributes: permitted, clerk_attributes: clerk_attributes }
        end

        def approval_group_error_message
          labels = Setting.approval_groups.map { |group| group.fetch("label") }
          "Approval group must be one of #{labels.join(', ')}, or blank"
        end
      end
    end
  end
end
