# frozen_string_literal: true

require "rails_helper"

RSpec.describe "Api::V1::Admin::ContactSettings", type: :request do
  let(:admin) { create(:user, :admin) }
  let(:employee) { create(:user, :employee) }

  let(:auth_headers_for) do
    ->(user) { { "Authorization" => "Bearer test_token_#{user.id}" } }
  end

  def json
    JSON.parse(response.body, symbolize_names: true)
  end

  describe "GET /api/v1/admin/contact_settings" do
    it "returns notification recipients and inquiry topics for admins" do
      get "/api/v1/admin/contact_settings", headers: auth_headers_for[admin]

      expect(response).to have_http_status(:ok)
      expect(json[:contact_notification_emails]).to include("admin@aireservicesguam.com")
      expect(json[:inquiry_topics]).to include("Private Pilot Certificate", "Discovery Flight")
    end

    it "blocks non-admin users" do
      get "/api/v1/admin/contact_settings", headers: auth_headers_for[employee]

      expect(response).to have_http_status(:forbidden)
    end
  end

  describe "PATCH /api/v1/admin/contact_settings" do
    it "updates notification recipients and inquiry topics together" do
      patch "/api/v1/admin/contact_settings",
            params: {
              contact_notification_emails: "ops@example.com\nowner@example.com",
              inquiry_topics: [ "Aerial Tours", "Video Packages", "General Inquiry" ]
            },
            headers: auth_headers_for[admin]

      expect(response).to have_http_status(:ok)
      expect(json[:contact_notification_emails]).to eq([ "ops@example.com", "owner@example.com" ])
      expect(json[:inquiry_topics]).to eq([ "Aerial Tours", "Video Packages", "General Inquiry" ])
      expect(Setting.contact_notification_emails).to eq([ "ops@example.com", "owner@example.com" ])
      expect(Setting.contact_inquiry_topics).to eq([ "Aerial Tours", "Video Packages", "General Inquiry" ])
    end

    it "rejects invalid email recipients" do
      patch "/api/v1/admin/contact_settings",
            params: {
              contact_notification_emails: [ "ops@example.com", "bad-email" ],
              inquiry_topics: [ "Aerial Tours" ]
            },
            headers: auth_headers_for[admin]

      expect(response).to have_http_status(:unprocessable_entity)
      expect(json[:error]).to match(/Invalid email address/)
    end

    it "rejects empty inquiry topics" do
      patch "/api/v1/admin/contact_settings",
            params: {
              contact_notification_emails: [ "ops@example.com" ],
              inquiry_topics: [ "", "  " ]
            },
            headers: auth_headers_for[admin]

      expect(response).to have_http_status(:unprocessable_entity)
      expect(json[:error]).to match(/At least one inquiry topic/)
    end
  end
end
