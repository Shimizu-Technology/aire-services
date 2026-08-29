# frozen_string_literal: true

module Api
  module V1
    module Admin
      class UsersController < BaseController
        include AttachmentUrlHelpers
        include MediaUploadValidation

        before_action :authenticate_user!
        before_action :require_admin!
        before_action :set_user,
                      only: [
                        :show,
                        :update,
                        :destroy,
                        :resend_invite,
                        :reset_kiosk_pin,
                        :public_team_photo,
                        :destroy_public_team_photo
                      ]
        rescue_from MediaUploadValidation::InvalidMediaUpload, with: :invalid_media_upload

        def index
          @users = User
                   .with_attached_public_team_photo
                   .includes(:user_approval_groups, user_time_categories: :time_category)
                   .order(created_at: :desc)

          if params[:role].present?
            @users = @users.where(role: params[:role])
          end

          pending_scope = @users
                          .where(personal_access_enabled: true)
                          .where("clerk_id IS NULL OR clerk_id LIKE 'pending_%'")

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
          role = params[:role] || "employee"
          approval_groups = normalized_approval_groups(params.key?(:approval_groups) ? params[:approval_groups] : params[:approval_group])
          approval_group = approval_groups.first
          personal_access_enabled = params.key?(:personal_access_enabled) ? boolean_param(:personal_access_enabled) : params[:email].present?
          send_invitation = params.key?(:send_invitation) ? boolean_param(:send_invitation) : personal_access_enabled

          if send_invitation && !personal_access_enabled
            return render json: { error: "Personal sign-in must be enabled when sending an invitation" }, status: :unprocessable_entity
          end

          access_configuration = nil

          begin
            ActiveRecord::Base.transaction do
              with_approval_group_lock_if_needed do
                unless valid_approval_groups?(approval_groups)
                  render json: { error: approval_group_error_message }, status: :unprocessable_entity
                  raise ActiveRecord::Rollback
                end

                @user = User.new(
                  staff_title: params[:staff_title]&.to_s&.strip&.presence,
                  is_intern: params.key?(:is_intern) ? ActiveModel::Type::Boolean.new.cast(params[:is_intern]) : false,
                  approval_group: approval_group,
                  clerk_id: "pending_#{SecureRandom.hex(8)}",
                  is_active: true
                )

                access_configuration = UserAccessConfiguration.new(
                  user: @user,
                  attributes: access_params.to_h.merge(
                    personal_access_enabled: personal_access_enabled,
                    role: role
                  ),
                  actor: current_user,
                  creating: true
                )
                access_configuration.apply!
                sync_approval_groups(@user, approval_groups)
              end
            end
          rescue UserAccessConfiguration::ConfigurationError => e
            return render json: { error: e.message }, status: :unprocessable_entity
          rescue ActiveRecord::RecordInvalid => e
            return render json: { error: e.record.errors.full_messages.join(", ") }, status: :unprocessable_entity
          end

          return if performed?

          email_sent = send_invitation ? send_invitation_email(@user) : nil

          render json: {
            user: serialize_user(@user),
            invitation_email_sent: email_sent,
            kiosk_pin: access_configuration&.generated_pin
          }, status: :created
        end

        def update
          if @user.id == current_user.id && params[:role].present? && params[:role] != current_user.role
            return render json: { error: "You cannot change your own role" }, status: :unprocessable_entity
          end

          if @user.id == current_user.id && params.key?(:personal_access_enabled) && !boolean_param(:personal_access_enabled)
            return render json: { error: "You cannot remove your own personal access" }, status: :unprocessable_entity
          end

          if @user.id == current_user.id && params.key?(:is_active) && !boolean_param(:is_active)
            return render json: { error: "You cannot deactivate your own account" }, status: :unprocessable_entity
          end

          if boolean_param(:send_invitation)
            personal_access_enabled = params.key?(:personal_access_enabled) ? boolean_param(:personal_access_enabled) : @user.personal_access_enabled?
            unless personal_access_enabled
              return render json: { error: "Personal sign-in must be enabled when sending an invitation" }, status: :unprocessable_entity
            end
          end

          clerk_attributes = {}
          previous_state = nil
          access_configuration = nil

          begin
            ActiveRecord::Base.transaction do
              with_approval_group_lock_if_needed do
                with_admin_transition_lock_if_needed do
                  last_admin_error = validate_last_admin_transition
                  if last_admin_error
                    render json: { error: last_admin_error }, status: :unprocessable_entity
                    raise ActiveRecord::Rollback
                  end

                  payload = normalized_update_params
                  raise ActiveRecord::Rollback if performed?

                  permitted = payload.fetch(:local_attributes)
                  clerk_attributes = payload.fetch(:clerk_attributes)
                  previous_state = snapshot_local_user_state(@user) if clerk_attributes.present?

                  @user.assign_attributes(permitted)
                  access_configuration = UserAccessConfiguration.new(
                    user: @user,
                    attributes: access_params.to_h,
                    actor: current_user
                  )
                  access_configuration.apply!
                  if params.key?(:approval_group) || params.key?(:approval_groups)
                    sync_approval_groups(@user, normalized_approval_groups(params.key?(:approval_groups) ? params[:approval_groups] : params[:approval_group]))
                  end
                end
              end
            end
          rescue UserAccessConfiguration::ConfigurationError => e
            return render json: { error: e.message }, status: :unprocessable_entity
          rescue ActiveRecord::RecordInvalid => e
            return render json: { error: e.record.errors.full_messages.join(", ") }, status: :unprocessable_entity
          end

          return if performed?

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

          invitation_email_sent = nil
          if boolean_param(:send_invitation) && @user.pending_invite?
            invitation_email_sent = send_invitation_email(@user)
          end

          render json: {
            user: serialize_user(@user.reload),
            invitation_email_sent: invitation_email_sent,
            kiosk_pin: access_configuration&.generated_pin
          }
        end

        def destroy
          if @user.id == current_user.id
            return render json: { error: "You cannot delete your own account" }, status: :unprocessable_entity
          end

          @user.destroy
          head :no_content
        end

        def resend_invite
          unless @user.personal_access_enabled? && @user.pending_invite?
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
          return render json: { error: "Enable time tracking before setting a kiosk PIN" }, status: :unprocessable_entity unless @user.time_tracking_enabled?
          return render json: { error: "Assign at least one active work category before setting a kiosk PIN" }, status: :unprocessable_entity if @user.assigned_time_categories.active.none?
          return render json: { error: "Clock this person out before changing their kiosk access" }, status: :unprocessable_entity if @user.time_entries.where(status: %w[clocked_in on_break]).exists?

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

        def public_team_photo
          upload = params[:photo].presence || params[:public_team_photo].presence
          return render json: { error: "Upload a team photo" }, status: :unprocessable_entity unless upload.present?

          validate_media_upload!(upload, media_type: "image", attachment_name: :photo)

          replaced_blob = @user.public_team_photo.blob if @user.public_team_photo.attached?
          @user.public_team_photo.attach(upload)
          replaced_blob&.purge_later

          render json: { user: serialize_user(@user.reload) }
        end

        def destroy_public_team_photo
          @user.public_team_photo.purge_later if @user.public_team_photo.attached?

          render json: { user: serialize_user(@user.reload) }
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
            staff_title: user.staff_title,
            is_intern: user.is_intern,
            approval_group: user.approval_group,
            approval_group_label: user.approval_group_label,
            approval_group_keys: user.approval_group_keys,
            approval_group_labels: user.approval_group_labels,
            approval_groups: user.approval_group_keys.map { |key| { key: key, label: Setting.approval_group_label_for(key) } },
            is_active: user.is_active,
            is_pending: user.pending_invite?,
            has_clerk_account: user.clerk_id.present? && !user.clerk_id.start_with?("pending_"),
            uses_clerk_profile: user.uses_clerk_profile?,
            personal_access_enabled: user.personal_access_enabled,
            profile_source: user.profile_source,
            time_tracking_enabled: user.time_tracking_enabled,
            public_team_enabled: user.public_team_enabled,
            public_team_name: user.public_team_name,
            public_team_title: user.public_team_title,
            public_team_sort_order: user.public_team_sort_order,
            public_team_photo_position_x: user.public_team_photo_position_x,
            public_team_photo_position_y: user.public_team_photo_position_y,
            public_team_photo_url: attachment_url(user.public_team_photo),
            public_team_photo_thumb_url: attachment_variant_url(user.public_team_photo, resize_to_limit: [ 160, nil ]),
            public_team_photo_card_url: attachment_variant_url(user.public_team_photo, resize_to_limit: [ 640, nil ]),
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

        # Snapshot only the local fields we mutate before Clerk sync, plus
        # assigned time categories, so rollback restores the exact pre-sync state.
        def snapshot_local_user_state(user)
          {
            attributes: user.attributes.slice(
              "email",
              "first_name",
              "last_name",
              "staff_title",
              "is_intern",
              "role",
              "personal_access_enabled",
              "profile_source",
              "time_tracking_enabled",
              "kiosk_enabled",
              "kiosk_pin_digest",
              "kiosk_pin_lookup_hash",
              "kiosk_pin_last_rotated_at",
              "kiosk_failed_attempts_count",
              "kiosk_locked_until",
              "approval_group",
              "is_active",
              "public_team_enabled",
              "public_team_name",
              "public_team_title",
              "public_team_sort_order",
              "public_team_photo_position_x",
              "public_team_photo_position_y",
              "updated_at"
            ),
            time_categories: user.user_time_categories.pluck(:time_category_id, :hourly_rate_cents),
            approval_groups: user.user_approval_groups.order(:id).pluck(:approval_group)
          }
        end

        def restore_local_user_state!(user, snapshot)
          ActiveRecord::Base.transaction do
            user.reload
            user.update_columns(snapshot.fetch(:attributes))
            restore_user_time_categories!(user, snapshot.fetch(:time_categories))
            sync_approval_groups(user, snapshot.fetch(:approval_groups))
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

        def normalized_approval_groups(value)
          Array(value).filter_map { |group| normalized_approval_group(group) }.uniq
        end

        def valid_approval_group?(value)
          value.nil? || Setting.approval_group_keys.include?(value)
        end

        def valid_approval_groups?(values)
          values.all? { |value| valid_approval_group?(value) }
        end

        def sync_approval_groups(user, approval_groups)
          desired_groups = Array(approval_groups).compact.uniq
          user.user_approval_groups.where.not(approval_group: desired_groups).destroy_all

          desired_groups.each do |approval_group|
            user.user_approval_groups.find_or_create_by!(approval_group: approval_group)
          end

          primary = desired_groups.first
          user.update_column(:approval_group, primary) if user.approval_group != primary
        end

        def with_approval_group_lock_if_needed
          return yield unless params.key?(:approval_group) || params.key?(:approval_groups)

          Setting.with_approval_groups_lock { yield }
        end

        def normalized_update_params
          permitted = {}
          keeps_personal_access = !params.key?(:personal_access_enabled) || boolean_param(:personal_access_enabled)
          active_clerk_user = keeps_personal_access && @user.personal_access_enabled? && @user.uses_clerk_profile? && !@user.pending_invite?
          clerk_attributes = {}

          if active_clerk_user && params.key?(:first_name)
            first_name = params[:first_name].to_s.strip
            if first_name.blank?
              render json: { error: "First name is required" }, status: :unprocessable_entity
              return { local_attributes: {}, clerk_attributes: {} }
            end

            permitted[:first_name] = first_name
            clerk_attributes[:first_name] = first_name if first_name != @user.first_name.to_s
          end

          if active_clerk_user && params.key?(:last_name)
            last_name = params[:last_name].to_s.strip.presence
            permitted[:last_name] = last_name
            clerk_attributes[:last_name] = last_name if last_name != @user.last_name.presence
          end

          if params.key?(:approval_group) || params.key?(:approval_groups)
            approval_groups = normalized_approval_groups(params.key?(:approval_groups) ? params[:approval_groups] : params[:approval_group])
            unless valid_approval_groups?(approval_groups)
              render json: { error: approval_group_error_message }, status: :unprocessable_entity
              return { local_attributes: {}, clerk_attributes: {} }
            end

            permitted[:approval_group] = approval_groups.first
          end

          if params.key?(:staff_title)
            permitted[:staff_title] = params[:staff_title].to_s.strip.presence
          end

          if params.key?(:is_intern)
            permitted[:is_intern] = ActiveModel::Type::Boolean.new.cast(params[:is_intern])
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

          if params.key?(:public_team_photo_position_x)
            position_x = normalized_photo_position(params[:public_team_photo_position_x], "horizontal")
            return { local_attributes: {}, clerk_attributes: {} } if performed?
            permitted[:public_team_photo_position_x] = position_x
          end

          if params.key?(:public_team_photo_position_y)
            position_y = normalized_photo_position(params[:public_team_photo_position_y], "vertical")
            return { local_attributes: {}, clerk_attributes: {} } if performed?
            permitted[:public_team_photo_position_y] = position_y
          end

          { local_attributes: permitted, clerk_attributes: clerk_attributes }
        end

        def access_params
          keys = %i[
            email first_name last_name role personal_access_enabled
            time_tracking_enabled kiosk_enabled kiosk_pin
            time_category_ids time_category_rate_overrides
          ]

          keys.each_with_object({}) do |key, attributes|
            attributes[key] = params[key] if params.key?(key)
          end
        end

        def boolean_param(key)
          return false unless params.key?(key)

          ActiveModel::Type::Boolean.new.cast(params[key])
        end

        def with_admin_transition_lock_if_needed
          if @user.admin? && @user.is_active? && @user.personal_access_enabled?
            User.admins.order(:id).lock.load
            @user.reload
          end

          yield
        end

        def validate_last_admin_transition
          return nil unless @user.admin? && @user.is_active? && @user.personal_access_enabled?

          remains_admin = params[:role].blank? || params[:role] == "admin"
          remains_active = !params.key?(:is_active) || boolean_param(:is_active)
          keeps_personal_access = !params.key?(:personal_access_enabled) || boolean_param(:personal_access_enabled)
          return nil if remains_admin && remains_active && keeps_personal_access
          return nil if User.admins.where(is_active: true, personal_access_enabled: true).where.not(id: @user.id).exists?

          "AIRE Ops must keep at least one active admin with personal sign-in"
        end

        def normalized_photo_position(value, axis_label)
          position = Integer(value)
          return position if position.between?(0, 100)

          render json: { error: "Public team photo #{axis_label} position must be between 0 and 100" }, status: :unprocessable_entity
          nil
        rescue ArgumentError, TypeError
          render json: { error: "Public team photo #{axis_label} position must be a whole number" }, status: :unprocessable_entity
          nil
        end

        def invalid_media_upload(exception)
          render json: { error: exception.message, errors: exception.messages }, status: :unprocessable_entity
        end

        def approval_group_error_message
          labels = Setting.approval_groups.map { |group| group.fetch("label") }
          "Department must be one of #{labels.join(', ')}, or blank"
        end
      end
    end
  end
end
