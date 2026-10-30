# frozen_string_literal: true

require "rails_helper"

RSpec.describe "Paused payroll integration", type: :request do
  around do |example|
    previous = ENV["CONNECTED_PAYROLL_MODE"]
    ENV["CONNECTED_PAYROLL_MODE"] = "paused"
    example.run
  ensure
    ENV["CONNECTED_PAYROLL_MODE"] = previous
  end

  it "holds calendar publication before any partial state is created" do
    expect(Payroll::CalendarPeriodPublisher).not_to receive(:new)
    expect { put "/api/v1/payroll/calendar_periods/123", params: {}, as: :json }.not_to change(PayrollCalendarPeriod, :count)
    expect(response).to have_http_status(:service_unavailable)
    expect(response.headers["Retry-After"]).to eq("60")
    expect(response.parsed_body.fetch("connected_payroll")).to include("mode" => "paused", "enabled" => false)
  end

  it "does not classify paused cockpit service availability as an authentication failure" do
    expect do
      get "/api/v1/payroll/cockpit/periods/123"
    end.not_to change { AuditLog.where(action: "payroll_cockpit.authorization_denied").count }
    expect(response).to have_http_status(:service_unavailable)
    expect(response.headers["Retry-After"]).to eq("60")
  end
end
