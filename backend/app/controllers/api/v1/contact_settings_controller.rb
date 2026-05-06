# frozen_string_literal: true

module Api
  module V1
    class ContactSettingsController < ApplicationController
      def show
        render json: {
          inquiry_topics: Setting.contact_inquiry_topics,
          public_contact: Setting.public_contact_settings
        }
      end
    end
  end
end
