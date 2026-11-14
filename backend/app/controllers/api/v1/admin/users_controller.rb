# frozen_string_literal: true

module Api
  module V1
    module Admin
      class UsersController < BaseController
        include AttachmentUrlHelpers
        include MediaUploadValidation

        before_action :authenticate_user!
        before_action -> { require_capability!(:manage_users) }
        before_action :set_user,
                      only: [
                        :show,
                        :termination_preview,
                        :update,
                        :destroy,
                        :terminate,
                        :reactivate,
                        :resend_invite,
                        :reset_kiosk_pin,
                        :public_team_photo,
                        :destroy_public_team_photo
                      ]
        before_action :require_access_change_permission!, only: [ :destroy, :terminate, :reactivate, :resend_invite, :reset_kiosk_pin ]
        rescue_from MediaUploadValidation::InvalidMediaUpload, with: :invalid_media_upload
        rescue_from MyPayAccess::InactivePerson do |error|
          render json: { error: error.message }, status: :unprocessable_entity
        end
        rescue_from JSON::ParserError do
          render json: { error: "Person changes must be valid JSON." }, status: :bad_request
        end
        rescue_from AdminPersonEdit::Conflict do |error|
          render json: { error: error.message }, status: :conflict
        end

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
            @users = @users.where(is_active: false, terminated_at: nil)
          elsif params[:status] == "terminated"
            @users = @users.where.not(terminated_at: nil)
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
          rescue UserAccessConfiguration::RoleNotPermitted => e
            return render json: { error: e.message }, status: :forbidden
          rescue UserAccessConfiguration::ConfigurationError => e
            return render json: { error: e.message }, status: :unprocessable_entity
          rescue ActiveRecord::RecordInvalid => e
            return render json: { error: e.record.errors.full_messages.join(", ") }, status: :unprocessable_entity
          end

          return if performed?

          email_sent = send_invitation ? send_invitation_email(@user) : nil

          render json: {
            user: serialize_user(@user),
            invitation_email_sent: email_sent == :captured ? false : email_sent,
            **(email_sent == :captured ? { invitation_email_captured: true } : {}),
            kiosk_pin: access_configuration&.generated_pin
          }, status: :created
        end

        def update
          # Multipart employment saves keep the photo and all fields atomic.
          if params.key?(:person_edit)
            parsed = JSON.parse(params[:person_edit].to_s)
            return render json: { error: "Person changes must be a JSON object." }, status: :bad_request unless parsed.is_a?(Hash)

            params.merge!(parsed)
          end
          # Refuse an already-stale form before evaluating its old role or
          # access choices. The authoritative check repeats under the row lock.
          AdminPersonEdit.check!(@user, params[:admin_edit_version])
          validate_media_upload!(params[:photo], media_type: "image", attachment_name: :photo) if params[:photo].present?
          if @user.id == current_user.id && params[:role].present? && params[:role] != current_user.role
            return render json: { error: "You cannot change your own role" }, status: :unprocessable_entity
          end

          if @user.id == current_user.id && params.key?(:personal_access_enabled) && !boolean_param(:personal_access_enabled)
            return render json: { error: "You cannot remove your own personal access" }, status: :unprocessable_entity
          end

          if @user.id == current_user.id && params.key?(:is_active) && !boolean_param(:is_active)
            return render json: { error: "You cannot deactivate your own account" }, status: :unprocessable_entity
          end

          if params[:role].present? && params[:role] != @user.role && !current_user.can_assign_role?(@user, params[:role])
            AuditLog.record_security_event!(action: "authorization.role_assignment_denied", actor: current_user, outcome: "denied",
              metadata: { path: request.path, target_user_id: @user.id, from: @user.role, to: params[:role].to_s })
            return render json: { error: "Only an owner can assign or change the owner and admin roles" }, status: :forbidden
          end

          return render_owner_required if access_change_requested? && !current_user.can_change_access_for?(@user)

          if boolean_param(:send_invitation)
            personal_access_enabled = params.key?(:personal_access_enabled) ? boolean_param(:personal_access_enabled) : @user.personal_access_enabled?
            unless personal_access_enabled
              return render json: { error: "Personal sign-in must be enabled when sending an invitation" }, status: :unprocessable_entity
            end
          end

          clerk_attributes = {}
          clerk_before = {}
          access_configuration = nil

          begin
            ActiveRecord::Base.transaction do
              with_approval_group_lock_if_needed do
                with_admin_transition_lock_if_needed do
                  AdminPersonEdit.check!(@user, params[:admin_edit_version])
                  if access_change_requested? && !current_user.can_change_access_for?(@user)
                    render_owner_required
                    raise ActiveRecord::Rollback
                  end
                  if @user.terminated?
                    render json: { error: "Reactivate this person before changing their setup." }, status: :unprocessable_entity
                    raise ActiveRecord::Rollback
                  end
                  last_admin_error = validate_last_admin_transition
                  if last_admin_error
                    render json: { error: last_admin_error }, status: :unprocessable_entity
                    raise ActiveRecord::Rollback
                  end

                  payload = normalized_update_params
                  raise ActiveRecord::Rollback if performed?

                  permitted = payload.fetch(:local_attributes)
                  clerk_attributes = payload.fetch(:clerk_attributes)
                  StagingOutboundPolicy.clerk_target!(id: @user.clerk_id) if clerk_attributes.present?

                  clerk_before = @user.attributes.slice(*clerk_attributes.keys.map(&:to_s))
                  previous_groups = @user.approval_group_keys.sort
                  @user.assign_attributes(permitted)
                  @user.admin_edit_version += 1
                  access_configuration = UserAccessConfiguration.new(
                    user: @user,
                    attributes: access_params.to_h,
                    actor: current_user
                  )
                  access_configuration.apply!
                  if params.key?(:approval_group) || params.key?(:approval_groups)
                    sync_approval_groups(@user, normalized_approval_groups(params.key?(:approval_groups) ? params[:approval_groups] : params[:approval_group]))
                    next_groups = @user.approval_group_keys.sort
                    if previous_groups != next_groups
                      AuditLog.record!(action: "user.updated", auditable: @user, actor: current_user,
                        event_category: "users", changes: { approval_groups: [ previous_groups, next_groups ] })
                    end
                  end
                  MyPayAccess.set_for_user!(user: @user, enabled: boolean_param(:my_pay_enabled), actor: current_user) if params.key?(:my_pay_enabled)
                  save_person_photo!
                end
              end
            end
          rescue StagingOutboundPolicy::Blocked => e
            return render json: { error: e.message, staging: true }, status: :service_unavailable
          rescue UserAccessConfiguration::RoleNotPermitted => e
            return render json: { error: e.message }, status: :forbidden
          rescue UserAccessConfiguration::ConfigurationError => e
            return render json: { error: e.message }, status: :unprocessable_entity
          rescue ActiveRecord::RecordInvalid => e
            return render json: { error: e.record.errors.full_messages.join(", ") }, status: :unprocessable_entity
          end

          return if performed?

          purge_person_photos!
          notice = nil
          if clerk_attributes.present?
            begin
              ClerkUserService.update_user!(clerk_user_id: @user.clerk_id, **clerk_attributes)
            rescue ClerkUserService::Error => e
              notice = "Changes saved in AIRE, but the name could not sync to Clerk. Try again later."
              AuditLog.record!(action: "user.clerk_sync_failed", auditable: @user, actor: current_user,
                event_category: "users", outcome: "failed",
                changes: clerk_attributes.to_h { |field, value| [ field, [ clerk_before[field.to_s], value ] ] },
                metadata: { local_changes_saved: true, clerk_sync_error: e.message })
            end
          end

          invitation_email_sent = nil
          if boolean_param(:send_invitation) && @user.pending_invite?
            invitation_email_sent = send_invitation_email(@user)
          end

          render json: {
            user: serialize_user(@user.reload),
            invitation_email_sent: invitation_email_sent == :captured ? false : invitation_email_sent,
            **(invitation_email_sent == :captured ? { invitation_email_captured: true } : {}),
            kiosk_pin: access_configuration&.generated_pin,
            notice: notice
          }
        end

        def destroy
          if @user.id == current_user.id
            return render json: { error: "You cannot delete your own account" }, status: :unprocessable_entity
          end

          blockers = @user.permanent_deletion_blockers
          if blockers.any?
            return render json: {
              error: "This is not an unused profile and cannot be permanently deleted. Terminate the employee instead so their history stays available.",
              blockers: blockers
            }, status: :unprocessable_entity
          end

          @user.destroy!
          head :no_content
        rescue ActiveRecord::RecordNotDestroyed => e
          render json: {
            error: "This is not an unused profile and cannot be permanently deleted. Terminate the employee instead so their history stays available.",
            blockers: e.record.errors.full_messages
          }, status: :unprocessable_entity
        end

        def termination_preview
          effective_on = termination_effective_on
          return unless effective_on

          render json: { preview: TerminationPreview.for(@user, effective_on: effective_on) }
        end

        def terminate
          if @user.id == current_user.id
            return render json: { error: "You cannot terminate your own account" }, status: :unprocessable_entity
          end

          if @user.terminated?
            return render json: { error: "This employee is already terminated" }, status: :unprocessable_entity
          end

          if @user.time_entries.where(status: %w[clocked_in on_break]).exists?
            return render json: { error: "Clock this employee out before terminating them so their final shift is recorded correctly." }, status: :unprocessable_entity
          end

          effective_on = termination_effective_on
          return if performed?

          begin
            ActiveRecord::Base.transaction do
              User.with_admin_access_lock { terminate_user_under_lock(effective_on) }
            end
          rescue ActiveRecord::RecordInvalid => e
            return render json: { error: e.record.errors.full_messages.join(", ") }, status: :unprocessable_entity
          end

          return if performed?

          render json: { user: serialize_user(@user.reload) }
        end

        def reactivate
          pin = nil
          User.transaction do
            User.with_admin_access_lock do
              @user.with_lock(User::EMPLOYEE_ROW_LOCK) do
                AdminPersonEdit.check!(@user, params[:admin_edit_version]) if params.key?(:admin_edit_version)
                return render_owner_required unless current_user.can_change_access_for?(@user)
                next if @user.is_active? && !@user.terminated?

                previous_status = @user.employment_status
                restored = @user.termination_access_snapshot
                personal = restored.fetch("personal_access_enabled", @user.personal_access_enabled?)
                tracking = restored.fetch("time_tracking_enabled", @user.time_tracking_enabled?)
                kiosk = restored.present? ? restored.fetch("kiosk_enabled", tracking) : @user.kiosk_enabled?
                before = @user.attributes.slice("is_active", "personal_access_enabled", "time_tracking_enabled", "kiosk_enabled")
                # A revoked PIN is never restored. Kiosk-only staff get a new
                # one-time PIN; personal accounts choose theirs on sign-in.
                @user.kiosk_pin = nil
                @user.kiosk_pin_digest = nil
                @user.kiosk_pin_lookup_hash = nil
                @user.kiosk_pin_last_rotated_at = nil
                @user.kiosk_failed_attempts_count = 0
                @user.kiosk_locked_until = nil
                if kiosk && !personal
                  pin = format("%06d", SecureRandom.random_number(1_000_000))
                  @user.kiosk_pin = pin
                  @user.kiosk_pin_last_rotated_at = Time.current
                end
                @user.update!(is_active: true, personal_access_enabled: personal, time_tracking_enabled: tracking,
                  kiosk_enabled: kiosk, terminated_at: nil, termination_effective_on: nil,
                  termination_reason: nil, terminated_by: nil, termination_access_snapshot: {},
                  admin_edit_version: @user.admin_edit_version + 1)
                changes = before.to_h { |key, value| [ key, [ value, @user.public_send(key) ] ] }
                changes["employment_status"] = [ previous_status, "active" ]
                AuditLog.record!(action: "admin.users.reactivate", auditable: @user, actor: current_user,
                  event_category: "users", changes: changes)
              end
            end
          end
          render json: { user: serialize_user(@user.reload), kiosk_pin: pin }
        rescue ActiveRecord::RecordInvalid => e
          render json: { error: e.record.errors.full_messages.join(", ") }, status: :unprocessable_entity
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

          if email_sent == :captured
            return render json: { message: "Invitation captured in staging; no email was sent.", invitation_email_sent: false, invitation_email_captured: true }
          end

          unless email_sent
            Rails.cache.delete(cache_key)
            return render json: { error: "Failed to send invitation email. Please check email configuration." }, status: :unprocessable_entity
          end

          render json: { message: "Invitation email resent to #{@user.email}" }
        end

        def reset_kiosk_pin
          pin = nil
          User.transaction do
            User.with_admin_access_lock do
              @user.with_lock(User::EMPLOYEE_ROW_LOCK) do
                AdminPersonEdit.check!(@user, params[:admin_edit_version])
                return render_owner_required unless current_user.can_change_access_for?(@user)
                return render json: { error: "Reactivate this person before resetting their kiosk PIN." }, status: :unprocessable_entity unless @user.is_active? && !@user.terminated?
                return render json: { error: "Kiosk PINs are only available for staff users" }, status: :unprocessable_entity unless @user.staff?
                return render json: { error: "Enable time tracking and kiosk access before setting a kiosk PIN" }, status: :unprocessable_entity unless @user.time_tracking_enabled? && @user.kiosk_enabled?
                return render json: { error: "Assign at least one active work category before setting a kiosk PIN" }, status: :unprocessable_entity if @user.assigned_time_categories.active.none?
                return render json: { error: "Clock this person out before changing their kiosk access" }, status: :unprocessable_entity if @user.time_entries.where(status: %w[clocked_in on_break]).exists?

                pin = params[:pin].presence || format("%06d", SecureRandom.random_number(1_000_000))
                version = @user.admin_edit_version
                @user.admin_edit_version += 1
                @user.skip_kiosk_pin_presence_validation = true
                @user.rotate_kiosk_pin!(pin)
                AuditLog.record!(action: "user.kiosk_pin_reset", auditable: @user, actor: current_user,
                  event_category: "users", changes: { admin_edit_version: [ version, @user.admin_edit_version ] },
                  metadata: { redacted_fields: [ "kiosk_pin" ] })
              end
            end
          end

          render json: { user: serialize_user(@user.reload), kiosk_pin: pin, message: "Kiosk PIN reset for #{@user.full_name}" }
        rescue ActiveRecord::RecordInvalid => e
          messages = e.record.errors.map { |err| err.attribute == :kiosk_pin_lookup_hash && err.type == :taken ? err.message : err.full_message }
          render json: { error: messages.join(", ") }, status: :unprocessable_entity
        end

        def public_team_photo
          upload = params[:photo].presence || params[:public_team_photo].presence
          return render json: { error: "Upload a team photo" }, status: :unprocessable_entity unless upload.present?

          validate_media_upload!(upload, media_type: "image", attachment_name: :photo)

          @user.with_lock(User::EMPLOYEE_ROW_LOCK) do
            AdminPersonEdit.check!(@user, params[:admin_edit_version]) if params.key?(:admin_edit_version)
            params[:photo] = upload
            save_person_photo!
            @user.update!(admin_edit_version: @user.admin_edit_version + 1)
          end
          purge_person_photos!

          render json: { user: serialize_user(@user.reload) }
        end

        def destroy_public_team_photo
          @user.with_lock(User::EMPLOYEE_ROW_LOCK) do
            AdminPersonEdit.check!(@user, params[:admin_edit_version]) if params.key?(:admin_edit_version)
            params[:remove_photo] = true
            save_person_photo!
            @user.update!(admin_edit_version: @user.admin_edit_version + 1)
          end
          purge_person_photos!

          render json: { user: serialize_user(@user.reload) }
        end

        private

        def set_user
          @user = User.find(params[:id])
        rescue ActiveRecord::RecordNotFound
          render json: { error: "User not found" }, status: :not_found
        end

        def require_access_change_permission!
          render_owner_required unless current_user.can_change_access_for?(@user)
        end

        # Sign-in, kiosk and invite details of an owner or admin are owner-only;
        # otherwise an admin could, for example, point a pending owner invite at
        # an address they control. Unchanged values (a full form save) pass.
        def access_change_requested?
          return true if params.key?(:email) && !params[:email].to_s.strip.casecmp?(@user.email.to_s)
          toggled = %i[personal_access_enabled time_tracking_enabled kiosk_enabled is_active].any? { |key|
            params.key?(key) && (boolean_param(key) == true) != @user.public_send(key)
          }
          return true if toggled

          params[:kiosk_pin].present? || boolean_param(:send_invitation) == true
        end

        def render_owner_required
          AuditLog.record_security_event!(action: "authorization.owner_denied", actor: current_user, outcome: "denied", metadata: { path: request.path, target_user_id: @user&.id })
          render json: { error: "Only an owner can change access for an owner or admin" }, status: :forbidden
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
            assignable_roles: current_user.roles_assignable_to(user),
            can_change_access: current_user.can_change_access_for?(user),
            admin_edit_version: user.admin_edit_version,
            public_team_bio: user.public_team_bio,
            my_pay_enabled: user.my_pay_enabled?,
            staff_title: user.staff_title,
            is_intern: user.is_intern,
            approval_group: user.approval_group,
            approval_group_label: user.approval_group_label,
            approval_group_keys: user.approval_group_keys,
            approval_group_labels: user.approval_group_labels,
            approval_groups: user.approval_group_keys.map { |key| { key: key, label: Setting.approval_group_label_for(key) } },
            is_active: user.is_active,
            employment_status: user.employment_status,
            terminated_at: user.terminated_at&.iso8601,
            termination_effective_on: user.termination_effective_on&.iso8601,
            termination_reason: user.termination_reason,
            terminated_by: user.terminated_by ? { id: user.terminated_by.id, full_name: user.terminated_by.full_name } : nil,
            can_delete_permanently: user.can_delete_permanently?,
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
            **(StagingOutboundPolicy.staging? ? { staging_artifact_blocked: attachment_url(user.public_team_photo).nil? } : {}),
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
            key: utc.time_category.key
          }
        end

        def send_invitation_email(user)
          sent = EmailService.send_invitation_email(user: user, invited_by: current_user)
          if StagingOutboundPolicy.staging?
            outcome = sent == :captured ? "captured" : sent ? "sent" : "failed"
            Rails.logger.info "[InviteEmail] STAGING #{outcome} user_id=#{user.id}; content redacted"
          elsif sent
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

            if !is_active
              render json: { error: "Use the termination action so the employee's final status and history are recorded." }, status: :unprocessable_entity
              return { local_attributes: {}, clerk_attributes: {} }
            end

            if @user.terminated?
              render json: { error: "Use the reactivation action for a terminated employee." }, status: :unprocessable_entity
              return { local_attributes: {}, clerk_attributes: {} }
            end

            permitted[:is_active] = true
          end

          if params.key?(:public_team_enabled)
            permitted[:public_team_enabled] = ActiveModel::Type::Boolean.new.cast(params[:public_team_enabled])
          end

          if params.key?(:public_team_name)
            permitted[:public_team_name] = params[:public_team_name].to_s.strip.presence
          end

          if params.key?(:public_team_bio)
            permitted[:public_team_bio] = params[:public_team_bio].to_s.strip.presence
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
            time_category_ids
          ]

          keys.each_with_object({}) do |key, attributes|
            attributes[key] = params[key] if params.key?(key)
          end
        end

        def boolean_param(key)
          return false unless params.key?(key)

          ActiveModel::Type::Boolean.new.cast(params[key])
        end

        def with_admin_transition_lock_if_needed(&block)
          # Access/role transitions serialize before locking any employee row.
          # Plain Employment/profile edits cannot remove the last administrator.
          if %i[role personal_access_enabled is_active].any? { |key| params.key?(key) }
            User.with_admin_access_lock { @user.with_lock(User::EMPLOYEE_ROW_LOCK, &block) }
          else
            @user.with_lock(User::EMPLOYEE_ROW_LOCK, &block)
          end
        end

        def save_person_photo!
          old_blob = @user.public_team_photo.blob if @user.public_team_photo.attached?
          before = old_blob&.id
          if params[:photo].present?
            @user.public_team_photo.attach(params[:photo])
          elsif boolean_param(:remove_photo)
            @user.public_team_photo.detach
          else
            return
          end
          after = @user.public_team_photo.blob_id if @user.public_team_photo.attached?
          if before != after
            (@person_photo_blobs_to_purge ||= []) << old_blob if old_blob
            AuditLog.record!(action: "user.updated", auditable: @user, actor: current_user,
              event_category: "users", changes: { public_team_photo: [ before, after ] })
          end
        end

        # Run only after the edit transaction commits. New uploads are attached
        # last; ActiveStorage uploads their bytes in its after-commit callback.
        def purge_person_photos!
          Array(@person_photo_blobs_to_purge).each(&:purge_later)
        end

        # Owners and admins keep the app administrable: the last active owner
        # and the last active owner-or-admin can't lose their role, activation
        # or personal sign-in. Runs under User.with_admin_access_lock.
        def validate_last_admin_transition
          return nil unless @user.administrator? && @user.is_active? && @user.personal_access_enabled?

          new_role = params[:role].presence || @user.role
          remains_active = !params.key?(:is_active) || boolean_param(:is_active)
          keeps_personal_access = !params.key?(:personal_access_enabled) || boolean_param(:personal_access_enabled)
          keeps_access = remains_active && keeps_personal_access

          return RoleAssignment::LAST_OWNER_MESSAGE if (new_role != "owner" || !keeps_access) && RoleAssignment.last_active_owner?(@user)
          return RoleAssignment::LAST_ADMINISTRATOR_MESSAGE if (!User::ADMINISTRATOR_ROLES.include?(new_role) || !keeps_access) && RoleAssignment.last_active_administrator?(@user)

          nil
        end

        def termination_effective_on
          value = params[:effective_on].presence || Time.current.in_time_zone(TimeClockService::BUSINESS_TIMEZONE).to_date.iso8601
          date = Date.iso8601(value.to_s)
          today = Time.current.in_time_zone(TimeClockService::BUSINESS_TIMEZONE).to_date
          if date > today
            render json: { error: "Termination effective date cannot be in the future" }, status: :unprocessable_entity
            return nil
          end
          date
        rescue Date::Error
          render json: { error: "Termination effective date must be a valid date" }, status: :unprocessable_entity
          nil
        end


        def terminate_user_under_lock(effective_on)
          @user.with_lock(User::EMPLOYEE_ROW_LOCK) do
            @user.reload
            AdminPersonEdit.check!(@user, params[:admin_edit_version]) if params.key?(:admin_edit_version)
            return render_owner_required unless current_user.can_change_access_for?(@user)
            if params.key?(:confirm_name) && params[:confirm_name].to_s != @user.full_name
              render json: { error: "Type the person's full name to confirm." }, status: :unprocessable_entity
              return
            end
            if @user.terminated?
              render json: { error: "This employee is already terminated" }, status: :unprocessable_entity
              return
            end

            if @user.time_entries.where(status: %w[clocked_in on_break]).exists?
              render json: { error: "Clock this employee out before terminating them so their final shift is recorded correctly." }, status: :unprocessable_entity
              return
            end

            last_access_error = if RoleAssignment.last_active_owner?(@user)
              RoleAssignment::LAST_OWNER_MESSAGE
            elsif RoleAssignment.last_active_administrator?(@user)
              RoleAssignment::LAST_ADMINISTRATOR_MESSAGE
            end
            if last_access_error
              render json: { error: last_access_error }, status: :unprocessable_entity
              return
            end

            previous_status = @user.employment_status
            previously_active = @user.is_active?
            access_before = @user.attributes.slice("personal_access_enabled", "time_tracking_enabled", "kiosk_enabled", "my_pay_enabled", "public_team_enabled")
            @user.kiosk_pin = nil
            @user.update!(
              termination_access_snapshot: @user.attributes.slice("personal_access_enabled", "time_tracking_enabled", "kiosk_enabled"),
              personal_access_enabled: false, kiosk_enabled: false, time_tracking_enabled: false, my_pay_enabled: false,
              kiosk_pin_digest: nil, kiosk_pin_lookup_hash: nil, kiosk_pin_last_rotated_at: nil,
              kiosk_failed_attempts_count: 0, kiosk_locked_until: nil,
              admin_edit_version: @user.admin_edit_version + 1,
              is_active: false,
              public_team_enabled: false,
              terminated_at: Time.current,
              termination_effective_on: effective_on,
              termination_reason: params[:reason].to_s.strip.presence,
              terminated_by: current_user
            )
            AuditLog.record!(
              action: "admin.users.terminate",
              auditable: @user,
              actor: current_user,
              event_category: "users",
              changes: {
                is_active: [ previously_active, false ],
                employment_status: [ previous_status, "terminated" ],
                termination_effective_on: [ nil, effective_on.iso8601 ]
              }.merge(access_before.to_h { |key, value| [ key, [ value, @user.public_send(key) ] ] })
            )
            ::PayDocuments::LinkRevoker.revoke_for_termination!(worker: @user, actor: current_user)
            TerminationPreview.open_leave(@user, effective_on: effective_on).order(:id).lock.each do |leave|
              before = leave.status
              leave.update!(status: "cancelled", cancelled_by: current_user, cancelled_at: Time.current,
                review_note: "Closed when employment ended.")
              AuditLog.record!(action: "leave_request.cancelled", auditable: leave, actor: current_user,
                event_category: "leave", changes: { status: [ before, "cancelled" ] },
                metadata: { target_user_id: @user.id, reason: "employment_ended", effective_on: effective_on.iso8601 })
            end
          end
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
