# frozen_string_literal: true

require "rails_helper"

RSpec.describe "Reported payment index integration contract", type: :request do
  let(:secret) { "payment-index-contract-test-secret" }
  let(:installation_id) { "bd816c8a-46bb-4b99-bde5-80a809b56cc5" }
  let!(:installation) { create(:setting, key: Payroll::IntegrationProfile::SOURCE_INSTANCE_SETTING_KEY, value: installation_id) }
  let(:actor) { create(:user, :admin, is_active: true, personal_access_enabled: true) }
  let(:employee) { create(:user, :employee) }
  let(:other_employee) { create(:user, :employee) }
  let(:category) { create(:time_category) }
  let(:grant) { PayrollIntegrationGrant.issue!(user: actor, capabilities: %w[settlement_case_management]) }
  let(:headers) do
    { "X-Payroll-Shared-Secret" => secret, "X-Aire-Delegation-Token" => grant.issued_token,
      "X-Payroll-Source-Instance-Id" => installation_id }
  end
  let(:period) { { start_date: "2026-08-01", end_date: "2026-08-15" } }
  let(:path) { "/api/v1/payroll/cockpit/payment_attestations" }

  around do |example|
    previous = ENV["PAYROLL_SHARED_SECRET"]
    ENV["PAYROLL_SHARED_SECRET"] = secret
    example.run
  ensure
    ENV["PAYROLL_SHARED_SECRET"] = previous
  end

  def attest(user:, date:)
    entry = create(:time_entry, user: user, time_category: category, work_date: Date.iso8601(date),
      entry_method: "manual", status: "completed", approval_status: "approved", overtime_status: "none")
    Payroll::PaymentAttestationRecorder.new(actor: actor).attest!(entry: entry,
      source_user_uuid: user.payroll_integration_uuid, reason: "Synthetic owner report awaiting exact issued evidence review")
  end

  def expect_integration
    descriptor = response.parsed_body.fetch("integration")
    expect(descriptor).to eq(Payroll::IntegrationProfile.call.deep_stringify_keys)
    expect(descriptor).to include("source_instance_id" => installation_id, "source_type" => "aire_services",
      "protocol" => "shimizu_time_payroll", "protocol_version" => "1.0")
    expect(descriptor.fetch("capabilities")).to include("payment_attestations", "payment_attestation_resolution_v1")
    expect(installation.reload.value).to eq(installation_id)
  end

  it "identifies the pinned producer even when a period contains no reports" do
    attest(user: employee, date: "2026-07-31")
    get path, params: period, headers: headers

    expect(response).to have_http_status(:ok)
    expect_integration
    expect(response.parsed_body.fetch("payment_attestations")).to eq([])
    expect(response.parsed_body.fetch("pagination")).to include("total_count" => 0, "total_pages" => 1,
      "current_page" => 1, "truncated" => false)
  end

  it "returns the same canonical identity on every period-only page across workers and date boundaries" do
    expected = [ attest(user: employee, date: "2026-08-01"), attest(user: other_employee, date: "2026-08-15") ]
    attest(user: employee, date: "2026-07-31")
    attest(user: other_employee, date: "2026-08-16")
    original = expected.map { |report| report.reload.attributes }
    history_count = PayrollPaymentAttestationEvent.count

    expected.each_with_index do |report, index|
      get path, params: period.merge(page: index + 1, per_page: 1), headers: headers
      expect(response).to have_http_status(:ok)
      expect_integration
      expect(response.parsed_body.fetch("payment_attestations").pluck("id")).to eq([ report.id.to_s ])
      expect(response.parsed_body.fetch("pagination")).to include("total_count" => 2, "total_pages" => 2,
        "current_page" => index + 1, "per_page" => 1, "truncated" => index.zero?)
    end

    expect(expected.map { |report| report.reload.attributes }).to eq(original)
    expect(PayrollPaymentAttestationEvent.count).to eq(history_count)
    expect(PayrollManualAllocation.count).to eq(0)
    expect(PayrollIntegrationCommand.count).to eq(0)
  end

  it "keeps employee and status filters with the descriptor instead of accepting caller-supplied identity" do
    expected = attest(user: employee, date: "2026-08-01")
    retracted = attest(user: employee, date: "2026-08-02")
    Payroll::PaymentAttestationRecorder.new(actor: actor).retract!(attestation: retracted, reason: "Synthetic owner corrected this report")
    attest(user: other_employee, date: "2026-08-01")

    get path, params: period.merge(source_user_uuid: employee.payroll_integration_uuid, status: "pending_evidence", per_page: 1,
      integration: { source_instance_id: SecureRandom.uuid, capabilities: [ "caller_supplied_capability" ] }), headers: headers

    expect(response).to have_http_status(:ok)
    expect_integration
    expect(response.parsed_body.fetch("payment_attestations").pluck("id")).to eq([ expected.id.to_s ])
    expect(response.parsed_body.fetch("pagination")).to include("total_count" => 1, "total_pages" => 1)
  end

  it "rejects a different installation before exposing report data or a descriptor" do
    attest(user: employee, date: "2026-08-01")
    get path, params: period, headers: headers.merge("X-Payroll-Source-Instance-Id" => SecureRandom.uuid)

    expect(response).to have_http_status(:conflict)
    expect(response.parsed_body.fetch("error")).to include("installation")
    expect(response.parsed_body).not_to have_key("integration")
    expect(response.parsed_body).not_to have_key("payment_attestations")
    expect(installation.reload.value).to eq(installation_id)
  end

  it "retains the delegated capability requirement for index reads" do
    restricted = PayrollIntegrationGrant.issue!(user: actor, capabilities: %w[time_approval])
    get path, params: period, headers: headers.merge("X-Aire-Delegation-Token" => restricted.issued_token)

    expect(response).to have_http_status(:forbidden)
    expect(response.parsed_body).not_to have_key("integration")
    expect(response.parsed_body).not_to have_key("payment_attestations")
    expect(installation.reload.value).to eq(installation_id)
  end
end
