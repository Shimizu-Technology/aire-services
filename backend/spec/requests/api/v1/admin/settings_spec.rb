# frozen_string_literal: true

require "rails_helper"

RSpec.describe "Api::V1::Admin::Settings", type: :request do
  let(:admin) { create(:user, :admin) }
  let(:employee) { create(:user, :employee) }

  let(:auth_headers_for) do
    ->(user) { { "Authorization" => "Bearer test_token_#{user.id}" } }
  end

  def json
    JSON.parse(response.body, symbolize_names: true)
  end

  describe "GET /api/v1/admin/settings" do
    it "returns time clock settings and approval groups for admin" do
      get "/api/v1/admin/settings", headers: auth_headers_for[admin]

      expect(response).to have_http_status(:ok)
      expect(json[:settings]).to include(
        overtime_daily_threshold_hours: be_a(String),
        overtime_weekly_threshold_hours: be_a(String),
        early_clock_in_buffer_minutes: be_a(String)
      )
      expect(json[:approval_groups]).to include(
        include(key: "cfi", label: "CFI"),
        include(key: "ops_maintenance", label: "Ops / Maintenance")
      )
    end

    it "blocks non-admin" do
      get "/api/v1/admin/settings", headers: auth_headers_for[employee]

      expect(response).to have_http_status(:forbidden)
    end
  end

  describe "PATCH /api/v1/admin/settings" do
    it "updates allowed keys" do
      patch "/api/v1/admin/settings",
            params: {
              settings: {
                early_clock_in_buffer_minutes: "10"
              }
            },
            headers: auth_headers_for[admin]

      expect(response).to have_http_status(:ok)
      expect(json.dig(:settings, :early_clock_in_buffer_minutes)).to eq("10")
      expect(Setting.get("early_clock_in_buffer_minutes")).to eq("10")
    end

    it "updates approval groups" do
      patch "/api/v1/admin/settings",
            params: {
              approval_groups: [
                { key: "", label: "CFI" },
                { key: "tour_ops", label: "Tour Ops" }
              ]
            },
            headers: auth_headers_for[admin]

      expect(response).to have_http_status(:ok)
      expect(json[:approval_groups]).to eq(
        [
          { key: "cfi", label: "CFI" },
          { key: "tour_ops", label: "Tour Ops" }
        ]
      )
      expect(Setting.approval_group_keys).to eq(%w[cfi tour_ops])
    end

    it "rejects removing approval groups that are in use" do
      create(:user, :employee, approval_group: "cfi")

      patch "/api/v1/admin/settings",
            params: {
              approval_groups: [
                { key: "ops_maintenance", label: "Ops / Maintenance" }
              ]
            },
            headers: auth_headers_for[admin]

      expect(response).to have_http_status(:unprocessable_entity)
      expect(json[:error]).to match(/Reassign users before removing departments/i)
    end

    it "rejects invalid thresholds" do
      patch "/api/v1/admin/settings",
            params: {
              settings: {
                overtime_daily_threshold_hours: "0"
              }
            },
            headers: auth_headers_for[admin]

      expect(response).to have_http_status(:unprocessable_entity)
    end

    it "rejects enabling location enforcement when stored coordinates are missing" do
      Setting.set("clock_in_location_latitude", "")
      Setting.set("clock_in_location_longitude", "")

      patch "/api/v1/admin/settings",
            params: {
              settings: {
                clock_in_location_enforced: "true"
              }
            },
            headers: auth_headers_for[admin]

      expect(response).to have_http_status(:unprocessable_entity)
      expect(json[:error]).to match(/Set a valid clock-in latitude and longitude before enabling location enforcement/i)
    end
  end

  describe "GET /api/v1/admin/settings/geocode" do
    it "returns geocoding matches for admins" do
      allow(AddressGeocodingService).to receive(:search).with(query: "AIRE Guam").and_return([
        {
          display_name: "AIRE Services Guam, Barrigada, Guam",
          latitude: "13.469130",
          longitude: "144.799010"
        }
      ])

      get "/api/v1/admin/settings/geocode",
           params: { query: "AIRE Guam" },
           headers: auth_headers_for[admin]

      expect(response).to have_http_status(:ok)
      expect(json[:results]).to eq([
        {
          display_name: "AIRE Services Guam, Barrigada, Guam",
          latitude: "13.469130",
          longitude: "144.799010"
        }
      ])
    end

    it "blocks non-admin geocoding" do
      get "/api/v1/admin/settings/geocode",
           params: { query: "AIRE Guam" },
           headers: auth_headers_for[employee]

      expect(response).to have_http_status(:forbidden)
    end
  end

  describe "GET /api/v1/admin/settings/place_autocomplete" do
    it "returns Google Places suggestions for admins" do
      allow(GooglePlacesService).to receive(:autocomplete)
        .with(query: "AIRE", session_token: "session-123")
        .and_return([
          {
            place_id: "places/aire",
            description: "AIRE Services Guam, Barrigada, Guam",
            main_text: "AIRE Services Guam",
            secondary_text: "Barrigada, Guam"
          }
        ])

      get "/api/v1/admin/settings/place_autocomplete",
          params: { query: "AIRE", session_token: "session-123" },
          headers: auth_headers_for[admin]

      expect(response).to have_http_status(:ok)
      expect(json[:suggestions]).to eq([
        {
          place_id: "places/aire",
          description: "AIRE Services Guam, Barrigada, Guam",
          main_text: "AIRE Services Guam",
          secondary_text: "Barrigada, Guam"
        }
      ])
    end

    it "blocks non-admin autocomplete" do
      get "/api/v1/admin/settings/place_autocomplete",
          params: { query: "AIRE", session_token: "session-123" },
          headers: auth_headers_for[employee]

      expect(response).to have_http_status(:forbidden)
    end
  end

  describe "GET /api/v1/admin/settings/place_details" do
    it "returns selected place details for admins" do
      allow(GooglePlacesService).to receive(:details)
        .with(place_id: "places/aire", session_token: "session-123")
        .and_return(
          place_id: "places/aire",
          display_name: "AIRE Services Guam",
          formatted_address: "1780 Admiral Sherman Boulevard, Barrigada, Guam 96913",
          latitude: "13.46913",
          longitude: "144.79901",
          plus_code: "7R65FQ9X+MM"
        )

      get "/api/v1/admin/settings/place_details",
          params: { place_id: "places/aire", session_token: "session-123" },
          headers: auth_headers_for[admin]

      expect(response).to have_http_status(:ok)
      expect(json[:place]).to eq(
        place_id: "places/aire",
        display_name: "AIRE Services Guam",
        formatted_address: "1780 Admiral Sherman Boulevard, Barrigada, Guam 96913",
        latitude: "13.46913",
        longitude: "144.79901",
        plus_code: "7R65FQ9X+MM"
      )
    end

    it "blocks non-admin place details" do
      get "/api/v1/admin/settings/place_details",
          params: { place_id: "places/aire", session_token: "session-123" },
          headers: auth_headers_for[employee]

      expect(response).to have_http_status(:forbidden)
    end
  end
end
