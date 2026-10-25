# frozen_string_literal: true

module Api
  module V1
    class ContactController < ApplicationController
      # POST /api/v1/contact
      # Public endpoint - no auth required
      def create
        name = params[:name]
        email = params[:email]
        phone = params[:phone]
        subject = params[:subject]
        message = params[:message]

        # Validate required fields
        errors = []
        errors << "Name is required" if name.blank?
        errors << "Email is required" if email.blank?
        errors << "Email format is invalid" if email.present? && !email.to_s.match?(URI::MailTo::EMAIL_REGEXP)
        errors << "Subject is required" if subject.blank?
        errors << "Message is required" if message.blank?
        errors << "Name is too long" if name.to_s.length > 120
        errors << "Email is too long" if email.to_s.length > 254
        errors << "Phone is too long" if phone.to_s.length > 40
        errors << "Subject is too long" if subject.to_s.length > 120
        errors << "Message is too long" if message.to_s.length > 5_000

        if errors.any?
          return render json: { error: errors.join(", ") }, status: :unprocessable_entity
        end

        # Send the email
        begin
          attributes = {
            name: name,
            email: email,
            phone: phone,
            subject: subject,
            message: message
          }
          result = if StagingOutboundPolicy.staging?
            ContactMailer.deliver_contact_form(**attributes)
          else
            ContactMailer.contact_form_email(**attributes).deliver_now
          end

          if StagingOutboundPolicy.staging? && result["staging_captured"]
            render json: { success: true, captured: true, sent: false, message: "Your message was captured in staging; no email was sent." }, status: :ok
          else
            render json: { success: true, message: "Your message has been sent successfully!" }, status: :ok
          end
        rescue => e
          Rails.logger.error "Contact form email failed: #{StagingOutboundPolicy.staging? ? "#{e.class}; content redacted" : e.message}"
          render json: { error: "Failed to send message. Please try again later." }, status: :internal_server_error
        end
      end
    end
  end
end
