# frozen_string_literal: true

require "rails_helper"

RSpec.describe Payroll::CutoffChangeClient do
  let(:env) { { "CORNERSTONE_PAYROLL_EVENTS_URL" => "https://payroll.example.test/api/v1/integrations/aire/events", "PAYROLL_SHARED_SECRET" => "secret-1" } }
  let(:external_id) { "6c6f636b-0000-4000-8000-000000000001" }
  let(:calls) { [] }

  def client_returning(code, body)
    http = lambda do |uri, headers, payload|
      calls << { uri: uri.to_s, headers: headers, body: JSON.parse(payload) }
      Struct.new(:code, :body).new(code.to_s, body.to_json)
    end
    described_class.new(env: env, http: http)
  end

  def request(client)
    client.request_change(external_pay_period_id: external_id, action: "change", cutoff_at: Time.iso8601("2026-11-21T12:00:00+10:00"),
      reason: "Holiday", actor: { system: "aire_services", user_id: 2, name: "Chels", role: "admin" }, request_id: "11111111-2222-4333-8444-555555555555")
  end

  it "posts the request to Cornerstone with the source credential and idempotency key" do
    change = request(client_returning(201, cutoff_change: { cutoff_at: "2026-11-21T12:00:00+10:00", override_id: "x" }))

    expect(change).to include("cutoff_at" => "2026-11-21T12:00:00+10:00")
    call = calls.sole
    expect(call[:uri]).to eq("https://payroll.example.test/api/v1/integrations/time_payroll/calendar_periods/#{external_id}/cutoff_change")
    expect(call[:headers]).to include("X-Shared-Secret" => "secret-1", "Idempotency-Key" => "11111111-2222-4333-8444-555555555555")
    expect(call[:body]).to eq(
      "schema_version" => "1.0", "action" => "change", "cutoff_at" => "2026-11-21T12:00:00+10:00", "reason" => "Holiday",
      "actor" => { "system" => "aire_services", "user_id" => 2, "name" => "Chels", "role" => "admin" }
    )
  end

  it "passes Cornerstone's explanation through and hides transport details" do
    expect { request(client_returning(422, error: "Choose a time at least two days before payday")) }
      .to raise_error(described_class::Rejected, "Choose a time at least two days before payday")
    expect { request(client_returning(401, error: "Invalid AIRE integration credentials")) }.to raise_error(described_class::Unavailable)
    expect { request(client_returning(500, error: "boom")) }.to raise_error(described_class::Unavailable, "Cornerstone returned HTTP 500")
    expect { described_class.new(env: env.except("PAYROLL_SHARED_SECRET"), http: ->(*) { }).request_change(external_pay_period_id: external_id, action: "lock_now", reason: "x", actor: {}, request_id: "r") }
      .to raise_error(described_class::Unavailable, /PAYROLL_SHARED_SECRET/)
  end
end
