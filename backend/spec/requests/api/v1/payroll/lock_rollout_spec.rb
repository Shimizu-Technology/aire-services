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
    PayrollLockRollout.configure!(starts_on: "2026-10-16", actor: "test operator", reason: "Approved rollout decision") unless RSpec.current_example.metadata[:unconfigured]
  end

  it "returns retryable service unavailable when the installation has no configuration", :unconfigured do
    expect(PayrollLockRollout.count).to eq(0)
    put "/api/v1/payroll/calendar_periods/oct-a", params: payload.to_json, headers: headers
    expect(response).to have_http_status(:service_unavailable)
    expect(response.parsed_body["error"]).to include("Configure")
    expect(PayrollCalendarPeriod.count).to eq(0)
    expect(PayrollCalendarPeriodRevision.count).to eq(0)
    expect(PayrollOutboxEvent.count).to eq(0)
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

  it "reports unenforced scheduled inventory as attention required with one shared rollout lookup" do
    [ Date.new(2026, 9, 1), Date.new(2026, 9, 16), Date.new(2026, 10, 1) ].each do |start|
      create(:payroll_calendar_period, start_date: start, end_date: start.day == 1 ? start.change(day: 15) : start.end_of_month,
        pay_date: "2026-10-31", cutoff_at: "2026-10-24T17:00:00+10:00")
    end
    [ Time.iso8601("2026-10-23T12:00:00+10:00"), Time.iso8601("2026-10-25T12:00:00+10:00") ].each do |now|
      queries = []
      subscriber = ->(_name, _start, _finish, _id, data) { queries << data[:sql] if data[:sql].match?(/SELECT.*FROM "payroll_lock_rollouts"/i) }
      travel_to(now) do
        ActiveSupport::Notifications.subscribed(subscriber, "sql.active_record") do
          get "/api/v1/payroll/calendar_periods", headers: headers
        end
      end
      expect(response).to have_http_status(:ok)
      expect(response.parsed_body.fetch("payroll_calendar_periods").map { |item| item.fetch("cutoff_state") })
        .to eq([ "attention_required" ] * 3)
      expect(queries.length).to eq(1)
    end
  end
end
