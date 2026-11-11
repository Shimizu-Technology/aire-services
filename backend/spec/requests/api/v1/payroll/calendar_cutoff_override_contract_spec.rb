# frozen_string_literal: true

require "rails_helper"

# Replays the publication Cornerstone pins in its
# spec/services/aire_payroll_calendar/cutoff_contract_spec.rb. Keep the two
# fixture copies identical.
RSpec.describe "Payroll calendar admin lock-time contract", type: :request do
  include ActiveSupport::Testing::TimeHelpers

  let(:secret) { "calendar-shared-secret" }
  let(:headers) { { "X-Shared-Secret" => secret, "Content-Type" => "application/json" } }
  let(:fixture) { JSON.parse(file_fixture("aire_cutoff_override_publication.json").read) }
  let(:external_id) { "6c6f636b-0000-4000-8000-0000000000c1" }

  around do |example|
    previous = ENV["PAYROLL_SHARED_SECRET"]
    ENV["PAYROLL_SHARED_SECRET"] = secret
    PayrollLockRollout.configure!(starts_on: "2026-10-16", actor: "test operator", reason: "Approved test rollout")
    travel_to(ActiveSupport::TimeZone["Pacific/Guam"].local(2026, 11, 18, 9)) { example.run }
  ensure
    ENV["PAYROLL_SHARED_SECRET"] = previous
  end

  it "accepts the pinned override publication and echoes the override" do
    put "/api/v1/payroll/calendar_periods/#{external_id}", params: fixture.merge("schedule_version" => 1).to_json, headers: headers

    expect(response).to have_http_status(:created)
    state = response.parsed_body.fetch("payroll_calendar_period")
    expect(state).to include(
      "cutoff_at" => "2026-11-21T12:00:00+10:00", "cutoff_source" => "override",
      "policy_cutoff_at" => "2026-11-22T17:00:00+10:00", "cutoff_state" => "upcoming"
    )
    expect(state.fetch("cutoff_override")).to eq(fixture.fetch("cutoff_override"))
    expect(state.fetch("next_scheduled_cutoff_at")).to eq("2026-11-21T12:00:00+10:00")
  end

  it "rejects the same moved cutoff when the publication claims the policy" do
    forged = fixture.except("cutoff_override", "policy_cutoff_at").merge("schedule_version" => 1, "cutoff_source" => "policy")
    put "/api/v1/payroll/calendar_periods/#{external_id}", params: forged.to_json, headers: headers

    expect(response).to have_http_status(:unprocessable_entity)
    expect(response.parsed_body.fetch("error")).to include("does not match the published cutoff policy")
    expect(PayrollCalendarPeriod.count).to eq(0)
  end
end
