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

          if params[:status] == "active"
            @users = @users.where.not(clerk_id: nil).where.not("clerk_id LIKE 'pending_%'")
          elsif params[:status] == "pending"
            @users = @users.where("clerk_id IS NULL OR clerk_id LIKE 'pending_%'")
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

          if first_name.blank?
            return render json: { error: "First name is required" }, status: :unprocessable_entity
          end

          unless %w[admin employee].include?(role)
            return render json: { error: "Role must be admin or employee" }, status: :unprocessable_entity
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
            first_name: first_name,
            last_name: last_name.presence,
            role: role,
            clerk_id: "pending_#{SecureRandom.hex(8)}"
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

          permitted = {}
          if params[:role].present? && %w[admin employee].include?(params[:role])
            permitted[:role] = params[:role]
          end

          if @user.update(permitted)
            sync_time_categories(@user) if params.key?(:time_category_ids)
            render json: { user: serialize_user(@user) }
          else
            render json: { error: @user.errors.full_messages.join(", ") }, status: :unprocessable_entity
          end
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
            user: serialize_user(@user),
            kiosk_pin: pin,
            message: "Kiosk PIN reset for #{@user.full_name}"
          }
        rescue ActiveRecord::RecordInvalid => e
          messages = e.record.errors.map { |err| err.type == :taken ? err.message : err.full_message }
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
            is_active: user.clerk_id.present? && !user.clerk_id.start_with?("pending_"),
            is_pending: user.clerk_id.blank? || user.clerk_id.start_with?("pending_"),
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

        def send_invitation_email(user)
          sent = EmailService.send_invitation_email(user: user, invited_by: current_user)
          if sent
            Rails.logger.info "Invitation email sent to #{user.email}"
          else
            Rails.logger.warn "Invitation email could not be sent to #{user.email}"
          end
          sent
        end
      end
    end
  end
end
