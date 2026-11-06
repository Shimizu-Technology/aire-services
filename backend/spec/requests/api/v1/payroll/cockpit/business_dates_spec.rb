# frozen_string_literal: true

require "rails_helper"

RSpec.describe "Settlement business dates", type: :request do
  include ActiveSupport::Testing::TimeHelpers

  around do |example|
    previous = ENV["PAYROLL_SHARED_SECRET"]
    ENV["PAYROLL_SHARED_SECRET"] = "va01-local-secret"
    Time.use_zone("UTC") { example.run }
  ensure
    ENV["PAYROLL_SHARED_SECRET"] = previous
  end

  [
    [ Time.utc(2026, 10, 24, 14, 30), Date.new(2026, 10, 25) ],
    [ Time.utc(2026, 10, 31, 14, 30), Date.new(2026, 11, 1) ],
    [ Time.utc(2026, 12, 31, 14, 30), Date.new(2027, 1, 1) ]
  ].each do |instant, today|
    it "counts due active cases through Guam #{today} on a UTC server" do
      batch = create(:payroll_batch)
      create(:payroll_settlement_case, origin_payroll_batch: batch, action_due_on: today - 1.day)
      create(:payroll_settlement_case, origin_payroll_batch: batch, action_due_on: today)
      create(:payroll_settlement_case, origin_payroll_batch: batch, action_due_on: today + 1.day)
      create(:payroll_settlement_case, origin_payroll_batch: batch, action_due_on: today, status: "not_payable", destination_kind: "not_payable", resolved_at: Time.current)

      travel_to(instant) do
        get "/api/v1/payroll/cockpit/settlement_cases", headers: { "X-Payroll-Shared-Secret" => "va01-local-secret" }
        expect(response).to have_http_status(:ok)
        expect(response.parsed_body.dig("summary", "attention_due")).to eq(2)
      end
    end
  end
end
