# frozen_string_literal: true

require "rails_helper"

RSpec.describe "Payroll rollout calendar contract", type: :request do
  include ActiveSupport::Testing::TimeHelpers

  let(:secret) { "lock-rollout-shared-secret" }
  let(:headers) { { "X-Shared-Secret" => secret, "Content-Type" => "application/json" } }
  let(:payload) do
    {
      schema_version: "2.0", start_date: "2026-10-01", end_date: "2026-10-15", pay_date: "2026-10-31",
      previous_regular_pay_date: "2026-10-15", cutoff_at: "2026-10-22T17:00:00+10:00",
      cutoff_rule: "after_previous_regular_payday", cutoff_days: 7, schedule_version: 1,
      publication_id: SecureRandom.uuid, lock_mode: "manual", cutoff_enforcement_starts_on: "2026-10-16"
    }
  end

  around do |example|
    previous = ENV["PAYROLL_SHARED_SECRET"]
    ENV["PAYROLL_SHARED_SECRET"] = secret
    example.run
  ensure
    ENV["PAYROLL_SHARED_SECRET"] = previous
  end

  before do
    PayrollLockRollout.configure!(starts_on: "2026-10-16", actor: "test operator", reason: "Approved rollout decision")
  end

  it "accepts and validates rollout fields, retains nominal cutoff, and reports one installation next cutoff" do
    travel_to(Time.iso8601("2026-10-24T12:00:00+10:00")) do
      put "/api/v1/payroll/calendar_periods/oct-a", params: payload.merge(lock_mode: "scheduled").to_json, headers: headers
      expect(response).to have_http_status(:unprocessable_entity)
      expect(response.parsed_body["error"]).to include("lock_mode")
      put "/api/v1/payroll/calendar_periods/oct-a", params: payload.to_json, headers: headers
      expect(response).to have_http_status(:created)
      expect(response.parsed_body.fetch("payroll_calendar_period")).to include("lock_mode" => "manual", "cutoff_at" => "2026-10-22T17:00:00+10:00")
      scheduled = payload.merge(start_date: "2026-10-16", end_date: "2026-10-31", pay_date: "2026-11-15",
        previous_regular_pay_date: "2026-10-31", cutoff_at: "2026-11-07T17:00:00+10:00", lock_mode: "scheduled", publication_id: SecureRandom.uuid)
      put "/api/v1/payroll/calendar_periods/oct-b", params: scheduled.to_json, headers: headers
      expect(response).to have_http_status(:created)
      get "/api/v1/payroll/calendar_periods", headers: headers
      body = response.parsed_body
      expect(body["next_scheduled_cutoff_at"]).to eq("2026-11-07T17:00:00+10:00")
      expect(body.fetch("payroll_calendar_periods").map { |period| period["next_scheduled_cutoff_at"] }.uniq)
        .to eq([ "2026-11-07T17:00:00+10:00" ])
    end
  end
end
