# frozen_string_literal: true

require "rails_helper"

RSpec.describe "Payroll calendar periods", type: :request do
  include ActiveSupport::Testing::TimeHelpers

  let(:secret) { "calendar-shared-secret" }
  let(:headers) { { "X-Shared-Secret" => secret, "Content-Type" => "application/json" } }
  let(:guam) { ActiveSupport::TimeZone["Pacific/Guam"] }
  let(:period_id) { "cornerstone-2026-10-a" }
  let(:payload) do
    {
      schema_version: "1.0",
      start_date: "2026-10-01",
      end_date: "2026-10-15",
      pay_date: "2026-10-25",
      cutoff_at: "2026-10-18T17:00:00+10:00",
      time_zone: "Pacific/Guam",
      cutoff_days_before: 7,
      schedule_version: 1,
      publication_id: SecureRandom.uuid
    }
  end

  around do |example|
    previous = ENV["PAYROLL_SHARED_SECRET"]
    ENV["PAYROLL_SHARED_SECRET"] = secret
    travel_to(guam.local(2026, 10, 1, 9)) { example.run }
  ensure
    ENV["PAYROLL_SHARED_SECRET"] = previous
  end

  it "requires service authentication" do
    put "/api/v1/payroll/calendar_periods/#{period_id}", params: payload.to_json,
        headers: { "Content-Type" => "application/json" }

    expect(response).to have_http_status(:unauthorized)

    [ "X-Shared-Secret", "X-Payroll-Shared-Secret" ].each do |header_name|
      put "/api/v1/payroll/calendar_periods/#{period_id}", params: payload.to_json,
          headers: { header_name => "wrong-secret", "Content-Type" => "application/json" }

      expect(response).to have_http_status(:unauthorized)
    end
  end

  it "accepts the payroll-specific shared-secret header" do
    put "/api/v1/payroll/calendar_periods/#{period_id}", params: payload.to_json,
        headers: { "X-Payroll-Shared-Secret" => secret, "Content-Type" => "application/json" }

    expect(response).to have_http_status(:created)
  end

  it "publishes, replays, lists, and returns version history" do
    put "/api/v1/payroll/calendar_periods/#{period_id}", params: payload.to_json, headers: headers
    expect(response).to have_http_status(:created)
    expect(response.parsed_body).to include("idempotent" => false)
    expect(response.parsed_body.dig("payroll_calendar_period", "cutoff_state")).to eq("upcoming")

    put "/api/v1/payroll/calendar_periods/#{period_id}", params: payload.to_json, headers: headers
    expect(response).to have_http_status(:ok)
    expect(response.parsed_body).to include("idempotent" => true)

    get "/api/v1/payroll/calendar_periods", headers: headers
    expect(response).to have_http_status(:ok)
    expect(response.parsed_body.fetch("payroll_calendar_periods").sole)
      .to include("external_pay_period_id" => period_id, "schedule_version" => 1)

    get "/api/v1/payroll/calendar_periods/#{period_id}", headers: headers
    expect(response).to have_http_status(:ok)
    expect(response.parsed_body.fetch("revisions").sole)
      .to include("publication_id" => payload.fetch(:publication_id), "schedule_version" => 1)
  end

  it "returns actionable validation and conflict responses" do
    invalid = payload.merge(cutoff_at: "2026-10-18T17:00:00")
    put "/api/v1/payroll/calendar_periods/#{period_id}", params: invalid.to_json, headers: headers
    expect(response).to have_http_status(:unprocessable_entity)
    expect(response.parsed_body.fetch("error")).to include("explicit UTC offset")

    put "/api/v1/payroll/calendar_periods/#{period_id}", params: payload.to_json, headers: headers
    stale = payload.merge(publication_id: SecureRandom.uuid)
    put "/api/v1/payroll/calendar_periods/#{period_id}", params: stale.to_json, headers: headers
    expect(response).to have_http_status(:conflict)
    expect(response.parsed_body.fetch("error")).to include("schedule_version must be 2")
  end

  it "fails closed when the integration secret is unavailable" do
    ENV.delete("PAYROLL_SHARED_SECRET")
    put "/api/v1/payroll/calendar_periods/#{period_id}", params: payload.to_json, headers: headers

    expect(response).to have_http_status(:service_unavailable)
  end
end
