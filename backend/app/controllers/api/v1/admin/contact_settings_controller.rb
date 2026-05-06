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
            inquiry_topics: Setting.contact_inquiry_topics,
            public_contact: Setting.public_contact_settings
          }
        end

        def update
          emails = Setting.normalize_emails(params[:contact_notification_emails])
          topics = Setting.normalize_contact_inquiry_topics(params[:inquiry_topics])
          raw_public_contact = public_contact_params
          public_contact = Setting.normalize_public_contact_settings(raw_public_contact)

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

          if missing_required_public_contact_fields?(raw_public_contact)
            return render json: { error: "Public phone, email, street address, region, and postal code are required" }, status: :unprocessable_entity
          end

          unless public_contact["email"].match?(URI::MailTo::EMAIL_REGEXP)
            return render json: { error: "Invalid public email address: #{public_contact['email']}" }, status: :unprocessable_entity
          end

          Setting.update_contact_settings!(emails: emails, topics: topics, public_contact: public_contact)

          render json: {
            contact_notification_emails: emails,
            inquiry_topics: topics,
            public_contact: public_contact,
            message: "Contact inquiry settings updated"
          }
        end

        private

        def public_contact_params
          return {} unless params[:public_contact].respond_to?(:permit)

          params[:public_contact].permit(
            :phone_display,
            :phone_e164,
            :email,
            :street_address,
            :address_area_label,
            :address_locality,
            :address_region,
            :postal_code,
            :address_country
          ).to_h
        end

        def missing_required_public_contact_fields?(raw_public_contact)
          required_keys = %w[phone_display phone_e164 email street_address address_region postal_code]
          raw_public_contact.blank? || required_keys.any? { |key| raw_public_contact[key].blank? }
        end
      end
    end
  end
end
