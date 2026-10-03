# frozen_string_literal: true

require "rails_helper"

RSpec.describe "Payroll history coverage API", type: :request do
  let(:path) { "/api/v1/payroll/cockpit/history_entries" }
  let(:admin) { create(:user, :admin, is_active: true, personal_access_enabled: true) }
  let(:employee) { create(:user, :employee) }
  let(:grant) { PayrollIntegrationGrant.issue!(user: admin, capabilities: %w[settlement_case_management]) }
  let(:headers) do
    {
      "X-Payroll-Shared-Secret" => "history-coverage-secret",
      "X-Aire-Delegation-Token" => grant.issued_token,
      "X-Payroll-Source-Instance-Id" => Payroll::IntegrationProfile.source_instance_id
    }
  end

  around do |example|
    previous = ENV["PAYROLL_SHARED_SECRET"]
    ENV["PAYROLL_SHARED_SECRET"] = "history-coverage-secret"
    example.run
  ensure
    ENV["PAYROLL_SHARED_SECRET"] = previous
  end

  def entry_on(date, **attributes)
    create(:time_entry, { user: employee, work_date: Date.iso8601(date), status: "completed",
                          entry_method: "manual", approval_status: "approved", approved_at: Time.current }.merge(attributes))
  end

  it "requires the service secret and settlement delegation" do
    get path, params: { through_work_date: "2026-09-15" }
    expect(response).to have_http_status(:unauthorized)

    get path, params: { through_work_date: "2026-09-15" }, headers: headers.except("X-Aire-Delegation-Token")
    expect(response).to have_http_status(:unauthorized)

    wrong_grant = PayrollIntegrationGrant.issue!(user: admin, capabilities: %w[time_approval])
    get path, params: { through_work_date: "2026-09-15" },
        headers: headers.merge("X-Aire-Delegation-Token" => wrong_grant.issued_token)
    expect(response).to have_http_status(:forbidden)
  end

  it "rejects a mismatched source installation before disclosing history" do
    get path, params: { through_work_date: "2026-09-15" },
        headers: headers.merge("X-Payroll-Source-Instance-Id" => SecureRandom.uuid)

    expect(response).to have_http_status(:conflict)
    expect(response.parsed_body).not_to have_key("time_entries")
  end

  it "includes pending, held, paid, and inclusive boundary entries without a calendar or personal fields" do
    pending = entry_on("2026-09-01", approval_status: "pending", description: "Private description")
    held = entry_on("2026-09-02")
    paid = entry_on("2026-09-15")
    entry_on("2026-09-16")
    Payroll::PaymentAttestationRecorder.new(actor: admin).attest!(
      entry: held, source_user_uuid: employee.payroll_integration_uuid,
      reason: "Owner reported payment; exact check evidence remains pending"
    )
    allocation = Payroll::ManualAllocationRecorder.new(actor: admin).commit!(
      entry: paid, source_user_uuid: employee.payroll_integration_uuid,
      regular_hours: 8, overtime_hours: 0, external_pay_period_id: "67", external_payroll_item_id: "91",
      pay_date: "2026-09-30", reason: "Verified the historical source and check hours"
    )
    Payroll::ManualAllocationRecorder.new(actor: admin).issue!(
      allocation: allocation, payment_method: "check", payment_reference: "SYNTHETIC-91",
      payment_effective_on: "2026-09-30", occurred_at: Time.current.iso8601,
      reason: "Verified physical delivery of the historical check"
    )

    get path, params: { through_work_date: "2026-09-15" }, headers: headers

    expect(response).to have_http_status(:ok)
    body = response.parsed_body
    expect(body).to include("source_state" => "current", "through_work_date" => "2026-09-15")
    rows = body.fetch("time_entries")
    expect(rows.pluck("id")).to eq([ pending, held, paid ].map { |entry| entry.id.to_s })
    expect(rows.map { |row| row.dig("lifecycle", "status") }).to eq(%w[awaiting_approval payment_attested_pending_evidence payment_issued])
    expect(rows.last).to include("version" => paid.lock_version, "work_date" => "2026-09-15", "hours" => 8.0,
                                "source_user_uuid" => employee.payroll_integration_uuid)
    expect(rows.first.fetch("state")).to include("approval_status" => "pending")
    expect(rows.first.keys).not_to include("description", "email", "name", "payment_reference")
    expect(rows.first.fetch("employee").keys).to contain_exactly("id", "payroll_integration_id")
    expect(body.dig("pagination", "total_count")).to eq(3)
    expect(PayrollCalendarPeriod.count).to eq(0)
    expect(AuditLog.where(action: "payroll_cockpit.read", source: "integration")).to exist
  end

  it "retains a legacy null-owner row with an explicit review requirement" do
    entry = entry_on("2026-09-15")
    # Model a legacy installation's nullable owner column inside this example's
    # rolled-back transaction; the current schema itself still requires owners.
    ActiveRecord::Base.connection.execute("ALTER TABLE time_entries ALTER COLUMN user_id DROP NOT NULL")
    entry.update_columns(user_id: nil)

    get path, params: { through_work_date: "2026-09-15" }, headers: headers

    expect(response).to have_http_status(:ok)
    row = response.parsed_body.fetch("time_entries").sole
    expect(row).to include("id" => entry.id.to_s, "source_user_uuid" => nil, "review_required" => true)
    expect(row.fetch("review_reasons")).to include("source_owner_missing", "source_employee_identity_missing")
    expect(response.parsed_body.dig("pagination", "total_count")).to eq(1)
  end

  it "bounds page size and keeps deterministic ID ordering across pages" do
    entries = [ "2026-09-15", "2026-09-01", "2026-09-08" ].map { |date| entry_on(date) }
    get path, params: { through_work_date: "2026-09-15", page: 2, per_page: 1 }, headers: headers

    expect(response).to have_http_status(:ok)
    expect(response.parsed_body.fetch("time_entries").pluck("id")).to eq([ entries[1].id.to_s ])
    expect(response.parsed_body.fetch("pagination")).to include(
      "current_page" => 2, "per_page" => 1, "total_count" => 3, "total_pages" => 3, "truncated" => true
    )

    get path, params: { through_work_date: "2026-09-15", per_page: 1000 }, headers: headers
    expect(response.parsed_body.dig("pagination", "per_page")).to eq(250)
  end

  [ nil, "", "2026-9-15", "2026-02-30", "2026-09-15T00:00:00Z" ].each do |date|
    it "rejects invalid through_work_date #{date.inspect}" do
      get path, params: { through_work_date: date }, headers: headers
      expect(response).to have_http_status(:unprocessable_entity)
      expect(response.parsed_body).not_to have_key("time_entries")
    end
  end

  [ { page: 0 }, { page: "1.5" }, { page: "abc" }, { per_page: -1 }, { per_page: "" } ].each do |paging|
    it "rejects invalid pagination #{paging.inspect}" do
      get path, params: { through_work_date: "2026-09-15" }.merge(paging), headers: headers
      expect(response).to have_http_status(:unprocessable_entity)
    end
  end
end
