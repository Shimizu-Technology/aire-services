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

  it "refuses a schedule version too large to store with 422 instead of failing" do
    put "/api/v1/payroll/calendar_periods/#{external_id}", params: fixture.merge("schedule_version" => 2**31).to_json, headers: headers
    expect(response).to have_http_status(:unprocessable_entity)
    expect(response.parsed_body.fetch("error")).to eq("schedule_version is too large")

    put "/api/v1/payroll/calendar_periods/#{external_id}", params: fixture.merge("schedule_version" => 1).to_json, headers: headers
    revision = fixture.merge("schedule_version" => 10**20, "publication_id" => SecureRandom.uuid)
    put "/api/v1/payroll/calendar_periods/#{external_id}", params: revision.to_json, headers: headers
    expect(response).to have_http_status(:unprocessable_entity)
    expect(PayrollCalendarPeriod.find_by!(external_pay_period_id: external_id).schedule_version).to eq(1)
  end

  describe "a late Lock now while payroll finalization holds its lock" do
    let(:lock_now) do
      fixture.merge("schedule_version" => 2, "publication_id" => SecureRandom.uuid,
        "cutoff_at" => 2.minutes.ago.change(usec: 0).iso8601,
        "cutoff_override" => fixture.fetch("cutoff_override").merge("override_id" => SecureRandom.uuid, "action" => "lock_now"))
    end

    before do
      put "/api/v1/payroll/calendar_periods/#{external_id}", params: fixture.merge("schedule_version" => 1).to_json, headers: headers
      expect(response).to have_http_status(:created)
    end

    def expect_retryable_busy_answer
      expect(response).to have_http_status(:service_unavailable)
      expect(response.headers["Retry-After"]).to eq("60")
      expect(response.parsed_body.fetch("error")).to eq("Payroll finalization is busy. Retry this publication.")
      # Busy is not a refusal: nothing to show as "AIRE couldn't apply".
      expect(AuditLog.where(action: Payroll::LockControl::REJECTED)).to be_empty
      expect(PayrollCalendarPeriod.find_by!(external_pay_period_id: external_id)).to have_attributes(schedule_version: 1, cutoff_override: include("action" => "change"))
    end

    it "answers 503 when the finalization lock wait times out" do
      database_config = ActiveRecord::Base.connection_db_config.configuration_hash
      locker = PG.connect(host: database_config[:host].presence || ENV["PGHOST"], port: database_config[:port].presence || ENV["PGPORT"],
        user: database_config[:username], password: database_config[:password], dbname: database_config.fetch(:database))
      locker.exec("SELECT pg_advisory_lock(#{Payroll::BatchFinalizer::ADVISORY_LOCK_KEY})")
      stub_const("Payroll::LockNowClaimFence::LOCK_TIMEOUT", "50ms")

      put "/api/v1/payroll/calendar_periods/#{external_id}", params: lock_now.to_json, headers: headers
      expect_retryable_busy_answer
    ensure
      locker&.exec("SELECT pg_advisory_unlock_all()")
      locker&.close
    end

    it "answers 503 when PostgreSQL breaks a deadlock with a late-hours command" do
      allow(Payroll::LockNowClaimFence).to receive(:call!).and_raise(ActiveRecord::Deadlocked, "PG::TRDeadlockDetected: deadlock detected")

      put "/api/v1/payroll/calendar_periods/#{external_id}", params: lock_now.to_json, headers: headers
      expect_retryable_busy_answer
    end
  end

  it "rejects the same moved cutoff when the publication claims the policy" do
    forged = fixture.except("cutoff_override", "policy_cutoff_at").merge("schedule_version" => 1, "cutoff_source" => "policy")
    put "/api/v1/payroll/calendar_periods/#{external_id}", params: forged.to_json, headers: headers

    expect(response).to have_http_status(:unprocessable_entity)
    expect(response.parsed_body.fetch("error")).to include("does not match the published cutoff policy")
    expect(PayrollCalendarPeriod.count).to eq(0)
  end
end
