# frozen_string_literal: true

require "rails_helper"

RSpec.describe "Api::V1::ContactSettings", type: :request do
  describe "GET /api/v1/contact_settings" do
    it "returns public inquiry topics" do
      Setting.set_contact_inquiry_topics!([ "Aerial Tours", "Video Packages" ])

      get "/api/v1/contact_settings"

      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body).fetch("inquiry_topics")).to eq([ "Aerial Tours", "Video Packages" ])
    end
  end
end
