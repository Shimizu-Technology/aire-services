# frozen_string_literal: true

require "rails_helper"

RSpec.describe "Api::V1::ContactSettings", type: :request do
  describe "GET /api/v1/contact_settings" do
    it "returns public inquiry topics and contact details" do
      Setting.set_contact_inquiry_topics!([ "Aerial Tours", "Video Packages" ])
      Setting.set_public_contact_settings!(
        "phone_display" => "(671) 555-0100",
        "email" => "frontdesk@example.com",
        "street_address" => "353 Admiral Sherman Boulevard",
        "phone_contacts" => [
          {
            "label" => "Tours, flight training & payments",
            "phone_display" => "(671) 477-4243",
            "phone_e164" => "+16714774243",
            "channel" => "phone"
          },
          {
            "label" => "WhatsApp contact",
            "phone_display" => "(671) 997-4243",
            "phone_e164" => "+16719974243",
            "channel" => "whatsapp"
          }
        ]
      )
      Setting.set_public_social_links!([
        { "label" => "Instagram", "url" => "https://www.instagram.com/aire.services/" },
        { "label" => "TikTok", "url" => "https://www.tiktok.com/@aireservicesguam" }
      ])

      get "/api/v1/contact_settings"

      expect(response).to have_http_status(:ok)
      payload = JSON.parse(response.body)
      expect(payload.fetch("inquiry_topics")).to eq([ "Aerial Tours", "Video Packages" ])
      expect(payload.dig("public_contact", "phone_display")).to eq("(671) 555-0100")
      expect(payload.dig("public_contact", "email")).to eq("frontdesk@example.com")
      expect(payload.dig("public_contact", "street_address")).to eq("353 Admiral Sherman Boulevard")
      expect(payload.dig("public_contact", "phone_contacts").map { |contact| contact.fetch("phone_e164") }).to eq([ "+16714774243", "+16719974243" ])
      expect(payload.dig("public_contact", "phone_contacts").last.fetch("channel")).to eq("whatsapp")
      expect(payload.fetch("social_links").map { |link| link.fetch("label") }).to eq([ "Instagram", "TikTok" ])
    end
  end
end
