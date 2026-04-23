# frozen_string_literal: true

module Api
  module V1
    module Admin
      class ContactSettingsController < Api::V1::BaseController
        before_action :authenticate_user!
        before_action :require_admin!

        def show
          render json: {
            contact_notification_emails: Setting.contact_notification_emails,
            inquiry_topics: Setting.contact_inquiry_topics
          }
        end

        def update
          emails = Setting.normalize_emails(params[:contact_notification_emails])
          topics = Setting.normalize_contact_inquiry_topics(params[:inquiry_topics])

          if emails.empty?
            return render json: { error: "At least one notification email is required" }, status: :unprocessable_entity
          end

          invalid = emails.reject { |email| email.match?(URI::MailTo::EMAIL_REGEXP) }
          if invalid.any?
            return render json: { error: "Invalid email address: #{invalid.first}" }, status: :unprocessable_entity
          end

          if topics.empty?
            return render json: { error: "At least one inquiry topic is required" }, status: :unprocessable_entity
          end

          Setting.update_contact_settings!(emails: emails, topics: topics)

          render json: {
            contact_notification_emails: emails,
            inquiry_topics: topics,
            message: "Contact inquiry settings updated"
          }
        end
      end
    end
  end
end
