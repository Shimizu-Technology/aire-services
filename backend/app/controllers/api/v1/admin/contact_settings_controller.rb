# frozen_string_literal: true

module Api
  module V1
    module Admin
      class ContactSettingsController < Api::V1::BaseController
        before_action :authenticate_user!
        before_action :require_admin!

        def show
          render json: { contact_notification_emails: contact_notification_emails }
        end

        def update
          emails = normalized_emails(params[:contact_notification_emails])

          if emails.empty?
            return render json: { error: "At least one notification email is required" }, status: :unprocessable_entity
          end

          invalid = emails.reject { |email| email.match?(URI::MailTo::EMAIL_REGEXP) }
          if invalid.any?
            return render json: { error: "Invalid email address: #{invalid.first}" }, status: :unprocessable_entity
          end

          Setting.set(
            "contact_email",
            emails.join(", "),
            description: "Comma-separated notification recipients for website contact inquiries"
          )

          render json: {
            contact_notification_emails: emails,
            message: "Contact inquiry notification emails updated"
          }
        end

        private

        def contact_notification_emails
          normalized_emails(Setting.get("contact_email") || "admin@aireservicesguam.com")
        end

        def normalized_emails(value)
          value.to_s
            .split(/[\n,;]+/)
            .map(&:strip)
            .reject(&:blank?)
            .uniq
        end
      end
    end
  end
end
