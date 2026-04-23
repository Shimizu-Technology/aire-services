# frozen_string_literal: true

module Api
  module V1
    class ContactSettingsController < ApplicationController
      def show
        render json: { inquiry_topics: Setting.contact_inquiry_topics }
      end
    end
  end
end
