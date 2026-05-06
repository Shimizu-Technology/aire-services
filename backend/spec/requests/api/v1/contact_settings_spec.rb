# frozen_string_literal: true

require "rails_helper"

RSpec.describe "Api::V1::ContactSettings", type: :request do
  describe "GET /api/v1/contact_settings" do
    it "returns public inquiry topics and contact details" do
      Setting.set_contact_inquiry_topics!([ "Aerial Tours", "Video Packages" ])
      Setting.set_public_contact_settings!(
        "phone_display" => "(671) 555-0100",
        "email" => "frontdesk@example.com",
        "street_address" => "353 Admiral Sherman Boulevard"
      )

      get "/api/v1/contact_settings"

      expect(response).to have_http_status(:ok)
      payload = JSON.parse(response.body)
      expect(payload.fetch("inquiry_topics")).to eq([ "Aerial Tours", "Video Packages" ])
      expect(payload.dig("public_contact", "phone_display")).to eq("(671) 555-0100")
      expect(payload.dig("public_contact", "email")).to eq("frontdesk@example.com")
      expect(payload.dig("public_contact", "street_address")).to eq("353 Admiral Sherman Boulevard")
    end
  end
end
