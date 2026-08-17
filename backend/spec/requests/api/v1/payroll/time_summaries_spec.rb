# frozen_string_literal: true

require "rails_helper"

RSpec.describe "Api::V1::Payroll::TimeSummaries", type: :request do
  let(:employee) { create(:user, :employee) }
  let(:secret) { "spec-payroll-secret" }
  let(:headers) { { "X-Shared-Secret" => secret } }

  around do |example|
    previous = ENV["PAYROLL_SHARED_SECRET"]
    ENV["PAYROLL_SHARED_SECRET"] = secret
    example.run
  ensure
    ENV["PAYROLL_SHARED_SECRET"] = previous
  end

  it "returns and deduplicates a protecting export snapshot for the same ledger" do
    create(:time_entry, user: employee, work_date: Date.new(2026, 6, 16), approval_status: nil, status: "completed")

    expect do
      get "/api/v1/payroll/time_summary", params: { start_date: "2026-06-16", end_date: "2026-06-30" }, headers: headers
    end.to change(ReportExport, :count).by(1)

    expect(response).to have_http_status(:ok)
    first_reference = JSON.parse(response.body).dig("export", "id")
    expect(first_reference).to start_with("AIRE-PAYROLL-")
    expect(ReportExport.last).to have_attributes(protects_entries: true, readiness_status: "complete")

    expect do
      get "/api/v1/payroll/time_summary", params: { start_date: "2026-06-16", end_date: "2026-06-30" }, headers: headers
    end.not_to change(ReportExport, :count)

    expect(JSON.parse(response.body).dig("export", "id")).to eq(first_reference)
    expect(ReportExport.last.reload.download_count).to eq(2)
  end
end
