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
                { label: "CFI" },
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
      expect(json[:error]).to match(/Reassign users before removing approval groups/i)
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
  end
end
