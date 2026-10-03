# frozen_string_literal: true

require "rails_helper"

RSpec.describe "Payroll source installation authorization", type: :request do
  around do |example|
    previous = ENV["PAYROLL_SHARED_SECRET"]
    ENV["PAYROLL_SHARED_SECRET"] = "installation-test-secret"
    example.run
  ensure
    ENV["PAYROLL_SHARED_SECRET"] = previous
  end

  let(:headers) { { "X-Payroll-Shared-Secret" => "installation-test-secret" } }

  [
    [ :post, "/api/v1/payroll/batches/other-batch/processing_events" ],
    [ :put, "/api/v1/payroll/calendar_periods/other-period" ],
    [ :post, "/api/v1/payroll/cockpit/time_entries/1/approval" ],
    [ :post, "/api/v1/payroll/cockpit/manual_allocations" ],
    [ :post, "/api/v1/payroll/cockpit/payment_attestations" ]
  ].each do |method, path|
    it "rejects a mismatched installation before #{method.upcase} #{path}" do
      pinned = headers.merge("X-Payroll-Source-Instance-Id" => SecureRandom.uuid)
      expect do
        public_send(method, path, headers: pinned)
      end.not_to change(PayrollIntegrationCommand, :count)

      expect(response).to have_http_status(:conflict)
      expect(JSON.parse(response.body).fetch("error")).to include("installation")
      expect(PayrollManualAllocation.count).to eq(0)
      expect(PayrollPaymentAttestation.count).to eq(0)
      expect(PayrollEntryProcessingEvent.count).to eq(0)
      expect(PayrollCalendarPeriod.count).to eq(0)
    end
  end

  it "accepts the pinned installation and permits existing unpinned clients" do
    instance_id = Payroll::IntegrationProfile.source_instance_id
    get "/api/v1/payroll/cockpit/employees", headers: headers.merge("X-Payroll-Source-Instance-Id" => instance_id)
    expect(response).to have_http_status(:ok)

    get "/api/v1/payroll/cockpit/employees", headers: headers
    expect(response).to have_http_status(:ok)
  end
end
