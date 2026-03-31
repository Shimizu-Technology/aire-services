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
        errors << "Subject is required" if subject.blank?
        errors << "Message is required" if message.blank?

        if errors.any?
          return render json: { error: errors.join(", ") }, status: :unprocessable_entity
        end

        # Send the email
        begin
          ContactMailer.contact_form_email(
            name: name,
            email: email,
            phone: phone,
            subject: subject,
            message: message
          ).deliver_now

          render json: { success: true, message: "Your message has been sent successfully!" }, status: :ok
        rescue => e
          Rails.logger.error "Contact form email failed: #{e.message}"
          render json: { error: "Failed to send message. Please try again later." }, status: :internal_server_error
        end
      end
    end
  end
end
