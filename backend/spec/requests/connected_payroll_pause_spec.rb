# frozen_string_literal: true

require "rails_helper"

RSpec.describe "Paused payroll integration", type: :request do
  it "holds calendar publication before any partial state is created" do
    allow(ConnectedPayrollMode).to receive(:enabled?).and_return(false)
    expect(Payroll::CalendarPeriodPublisher).not_to receive(:new)
    expect { put "/api/v1/payroll/calendar_periods/123", params: {}, as: :json }.not_to change(PayrollCalendarPeriod, :count)
    expect(response).to have_http_status(:service_unavailable)
    expect(response.headers["Retry-After"]).to eq("60")
    expect(response.parsed_body.dig("connected_payroll", "enabled")).to be(false)
  end
end
