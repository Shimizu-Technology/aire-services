# frozen_string_literal: true

module Api
  module V1
    module PayStubs
      # Who gets a heads-up email when a worker asks for a stub at the kiosk.
      # Empty by default, so requests appear only in the in-app list. Owners
      # and admins (manage_settings) change it; senders can see it.
      class NotificationEmailsController < BaseController
        MAX_RECIPIENTS = 10

        before_action -> { require_capability!(:manage_settings) }, only: :update

        # GET /api/v1/pay_stubs/notification_emails
        def show
          render json: { emails: ::PayDocuments.request_notice_emails, editable: current_user.can_manage_settings? }
        end

        # PATCH /api/v1/pay_stubs/notification_emails
        def update
          emails = Setting.normalize_emails(params[:emails]).map(&:downcase).uniq
          invalid = emails.reject { |email| email.length <= ::PayDocuments::EMAIL_MAX_LENGTH && ::PayDocuments::EMAIL_FORMAT.match?(email) }
          raise ::PayDocuments::Error.new("These don't look like email addresses: #{invalid.join(', ')}", code: "invalid_email") if invalid.any?
          raise ::PayDocuments::Error.new("Use #{MAX_RECIPIENTS} addresses or fewer.", code: "too_many_recipients") if emails.size > MAX_RECIPIENTS

          before = ::PayDocuments.request_notice_emails
          setting = Setting.set(::PayDocuments::REQUEST_NOTICE_SETTING, emails.join(", "), description: "Who is emailed when a worker requests a pay stub at the kiosk")
          AuditLog.record!(action: "setting.pay_stub_request_notification_emails_updated", auditable: setting, actor: current_user,
            event_category: "settings", changes: { pay_stub_request_notification_emails: [ before, emails ] })
          render json: { emails: emails, editable: true }
        end
      end
    end
  end
end
