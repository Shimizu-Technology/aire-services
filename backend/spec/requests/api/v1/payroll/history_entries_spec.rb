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

  it "reports deleted or out-of-scope frozen obligations instead of silently dropping their history" do
    entry = entry_on("2026-09-01")
    batch = create(:payroll_batch)
    batch.payroll_batch_entries.create!(source_time_entry_id: entry.id, source_user_id: employee.id,
      source_user_uuid: employee.payroll_integration_uuid, source_kind: "current", line_key: "historical",
      work_date: entry.work_date, week_start: entry.work_date.beginning_of_week(:sunday), total_hours: entry.hours,
      regular_hours: entry.hours, overtime_hours: 0, snapshot: {})
    entry.update!(work_date: Date.new(2026, 10, 1))
    get path, params: { through_work_date: "2026-09-15" }, headers: headers
    expect(response).to have_http_status(:ok)
    expect(response.parsed_body).to include("unresolved_historical_obligation_count" => 1, "time_entries" => [])
    entry.destroy!
    get path, params: { through_work_date: "2026-09-15" }, headers: headers
    expect(response.parsed_body).to include("unresolved_historical_obligation_count" => 1, "time_entries" => [])
  end

  it "retains a wholly unpaid frozen pending exclusion when its source moves or is deleted" do
    entry = entry_on("2026-09-03")
    batch = create(:payroll_batch)
    batch.payroll_batch_exclusions.create!(source_time_entry_id: entry.id, source_user_id: employee.id,
      source_user_uuid: employee.payroll_integration_uuid, reason: "pending_overtime",
      held_total_hours: 8, held_regular_hours: 0, held_overtime_hours: 8,
      snapshot: { "work_date" => "2026-09-03" })
    get path, params: { through_work_date: "2026-09-15" }, headers: headers
    expect(response.parsed_body["unresolved_historical_obligation_count"]).to eq(0)
    entry.update!(work_date: Date.new(2026, 10, 1))
    get path, params: { through_work_date: "2026-09-15" }, headers: headers
    expect(response.parsed_body).to include("unresolved_historical_obligation_count" => 1, "time_entries" => [])
    entry.destroy!
    get path, params: { through_work_date: "2026-09-15" }, headers: headers
    expect(response.parsed_body).to include("unresolved_historical_obligation_count" => 1, "time_entries" => [])
    expect(PayrollBatchEntry.where(source_time_entry_id: entry.id)).not_to exist
  end

  it "keeps moved held, allocated and owed obligations visible as blockers" do
    held = entry_on("2026-09-02")
    allocated = entry_on("2026-09-03")
    owed = entry_on("2026-09-04")
    Payroll::PaymentAttestationRecorder.new(actor: admin).attest!(entry: held,
      source_user_uuid: employee.payroll_integration_uuid, reason: "Synthetic reported payment awaiting exact evidence")
    Payroll::ManualAllocationRecorder.new(actor: admin).commit!(entry: allocated,
      source_user_uuid: employee.payroll_integration_uuid, regular_hours: 8, overtime_hours: 0,
      external_pay_period_id: "76", external_payroll_item_id: "91", pay_date: "2026-09-30",
      reason: "Synthetic committed allocation retained for historical review")
    create(:payroll_settlement_case, source_time_entry_id: owed.id, source_time_entry_version: owed.lock_version,
      source_user_id: employee.id, source_user_uuid: employee.payroll_integration_uuid,
      original_work_date: owed.work_date, origin_reason: "legacy_history_review", held_total_hours: owed.hours)
    [ held, allocated, owed ].each { |entry| entry.update_columns(work_date: Date.new(2026, 10, 1)) }
    get path, params: { through_work_date: "2026-09-15" }, headers: headers
    expect(response).to have_http_status(:ok)
    expect(response.parsed_body).to include("unresolved_historical_obligation_count" => 3, "time_entries" => [])
  end

  it "exports exact immutable manual baseline provenance without asserting delivery" do
    entry = entry_on("2026-09-01")
    entry.update_columns(created_at: 1.day.ago, updated_at: 1.day.ago, approved_at: 1.day.ago)
    batch = Payroll::BatchFinalizer.new(start_date: "2026-09-01", end_date: "2026-09-15", actor: admin,
      manual_processing: true, cutoff_at: 1.minute.ago.iso8601, processed_at: Time.current.iso8601,
      external_pay_period_id: "76", processing_note: "Reviewed synthetic manually processed historical source").call
    get path, params: { through_work_date: "2026-09-15" }, headers: headers
    expect(response).to have_http_status(:ok)
    body = response.parsed_body
    expect(body).to include("history_evidence_version" => 1)
    expect(body.dig("integration", "source_instance_id")).to eq(Payroll::IntegrationProfile.source_instance_id)
    evidence = body.fetch("time_entries").sole.fetch("history_evidence")
    line = evidence.fetch("baseline_lines").sole
    expect(line).to include("batch_id" => batch.public_id, "batch_checksum" => batch.checksum,
      "source_time_entry_id" => entry.id.to_s, "source_user_uuid" => employee.payroll_integration_uuid,
      "current_content_matches" => true, "source_time_entry_version" => entry.lock_version)
    expect(line.fetch("processing")).to include("status" => "committed", "external_system" => "cornerstone_payroll_manual", "external_pay_period_id" => "76")
    expect(evidence.fetch("payable_content_checksum")).to match(/\A[0-9a-f]{64}\z/)
    expect(evidence.fetch("active_manual_allocation_ids")).to eq([])
    expect(evidence["payment_attestation"]).to be_nil
    expect(PayrollEntryProcessingEvent.count).to eq(0)
    expect(PayrollManualAllocation.count).to eq(0)
    entry.update_column(:hours, 7)
    get path, params: { through_work_date: "2026-09-15" }, headers: headers
    expect(response.parsed_body.fetch("time_entries").sole.dig("history_evidence", "baseline_lines", 0, "current_content_matches")).to be(false)
  end

  it "exports current payable segments that match frozen overnight and split-shift baseline rows" do
    guam = ActiveSupport::TimeZone["Pacific/Guam"]
    # Saturday 22:00 to Sunday 02:00 Guam, split at Sunday 00:00.
    overnight = entry_on("2026-09-12")
    overnight.update_columns(start_time: guam.local(2026, 9, 12, 22), end_time: guam.local(2026, 9, 13, 2), hours: 4,
      created_at: 1.day.ago, updated_at: 1.day.ago, approved_at: 1.day.ago)
    # A second employee's Thursday 20:00 to Friday 03:00 shift with a 23:00-00:00 break.
    split = entry_on("2026-09-10", user: create(:user, :employee))
    split.update_columns(start_time: guam.local(2026, 9, 10, 20), end_time: guam.local(2026, 9, 11, 3), hours: 6, break_minutes: 0)
    TimeEntryBreak.create!(time_entry: split, start_time: guam.local(2026, 9, 10, 23), end_time: guam.local(2026, 9, 11, 0))
    split.update_columns(break_minutes: 60, created_at: 1.day.ago, updated_at: 1.day.ago, approved_at: 1.day.ago)
    batch = Payroll::BatchFinalizer.new(start_date: "2026-09-01", end_date: "2026-09-15", actor: admin,
      manual_processing: true, cutoff_at: 1.minute.ago.iso8601, processed_at: Time.current.iso8601,
      external_pay_period_id: "76", processing_note: "Reviewed synthetic manually processed multi-day sources").call
    expect do
      get path, params: { through_work_date: "2026-09-15" }, headers: headers
    end.not_to change { [ PayrollEntryProcessingEvent.count, PayrollManualAllocation.count, PayrollPaymentAttestation.count ] }
    expect(response).to have_http_status(:ok)
    rows = response.parsed_body.fetch("time_entries").index_by { |row| row.fetch("id") }
    { overnight => [ [ "2026-09-12", "2.0" ], [ "2026-09-13", "2.0" ] ],
      split => [ [ "2026-09-10", "3.0" ], [ "2026-09-11", "3.0" ] ] }.each do |entry, expected|
      row = rows.fetch(entry.id.to_s)
      evidence = row.fetch("history_evidence")
      expect(row.fetch("work_date")).to eq(expected.first.first)
      expect(evidence.fetch("payable_segments")).to eq(expected.map { |date, hours| { "work_date" => date, "total_hours" => hours } })
      lines = evidence.fetch("baseline_lines").sort_by { |line| line.fetch("work_date") }
      expect(lines.map { |line| [ line.fetch("work_date"), BigDecimal(line.fetch("total_hours")) ] })
        .to eq(expected.map { |date, hours| [ date, BigDecimal(hours) ] })
      expect(lines).to all(include("batch_id" => batch.public_id, "current_content_matches" => true))
    end
  end

  it "exports separately typed unchanged legacy evidence without approving time or creating payments" do
    entry = create(:time_entry, user: employee, work_date: "2026-09-01", status: "completed",
      entry_method: "manual", approval_status: "pending", skip_overtime_recomputation: true,
      created_at: Time.utc(2026, 9, 1), updated_at: Time.utc(2026, 9, 2))
    payload = { "schema_version" => "2.0", "employees" => [] }
    batch = create(:payroll_batch, payload: payload, checksum: Payroll::CanonicalPayload.checksum(payload))
    snapshot = entry.attributes.slice(*Payroll::LegacyFrozenBatchEvidence::SCALAR_FIELDS)
      .merge("time_category" => entry.time_category.attributes.slice("id", "key", "name"))
    batch.payroll_batch_entries.create!(source_time_entry_id: entry.id, source_user_id: entry.user_id,
      source_kind: "current", line_key: "legacy", work_date: entry.work_date,
      week_start: entry.work_date.beginning_of_week(:sunday), total_hours: entry.hours,
      regular_hours: entry.hours, overtime_hours: 0, snapshot: snapshot)
    batch.payroll_batch_processing_events.create!(event_id: "synthetic-frozen-legacy", status: "committed",
      external_system: "cornerstone_payroll_manual", external_pay_period_id: "76", occurred_at: batch.finalized_at)
    expect do
      get path, params: { through_work_date: "2026-09-15" }, headers: headers
    end.not_to change { [ PayrollEntryProcessingEvent.count, PayrollManualAllocation.count, entry.reload.approval_status ] }
    expect(response).to have_http_status(:ok)
    line = response.parsed_body.fetch("time_entries").sole.dig("history_evidence", "baseline_lines").sole
    expect(line).to include("source_time_entry_version" => nil, "current_content_matches" => false,
      "source_user_uuid" => employee.payroll_integration_uuid, "identity_basis" => "reviewed_legacy_owner")
    expect(line.fetch("legacy_frozen_evidence")).to include("kind" => "legacy_frozen_batch_baseline", "eligible" => true,
      "evidence_strength" => "retained_snapshot_and_unchanged_source", "blockers" => [])
  end

  it "does not treat a post-snapshot legacy observation as proof of original chronology" do
    entry = entry_on("2026-09-01")
    batch = create(:payroll_batch)
    batch.payroll_batch_entries.create!(source_time_entry_id: entry.id, source_user_id: entry.user_id,
      source_user_uuid: employee.payroll_integration_uuid, source_kind: "current", line_key: "legacy",
      work_date: entry.work_date, week_start: entry.work_date.beginning_of_week(:sunday),
      total_hours: entry.hours, regular_hours: entry.hours, overtime_hours: 0,
      snapshot: { "user_id" => entry.user_id, "hours" => entry.hours.to_f })
    batch.payroll_batch_processing_events.create!(event_id: "synthetic-legacy-manual", status: "committed",
      external_system: "cornerstone_payroll_manual", external_pay_period_id: "76", occurred_at: batch.cutoff_at)
    get path, params: { through_work_date: "2026-09-15" }, headers: headers
    expect(response).to have_http_status(:ok)
    line = response.parsed_body.fetch("time_entries").sole.dig("history_evidence", "baseline_lines").sole
    expect(line).to include("source_time_entry_version" => nil, "source_comparison" => "legacy_observation", "current_content_matches" => false)
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

  it "rejects a page whose offset exceeds the database integer range" do
    get path, params: { through_work_date: "2026-09-15", page: 2**63, per_page: 250 }, headers: headers
    expect(response).to have_http_status(:unprocessable_entity)
    expect(response.parsed_body.fetch("error")).to include("pagination range")
  end

  [ { page: 0 }, { page: "1.5" }, { page: "abc" }, { per_page: -1 }, { per_page: "" } ].each do |paging|
    it "rejects invalid pagination #{paging.inspect}" do
      get path, params: { through_work_date: "2026-09-15" }.merge(paging), headers: headers
      expect(response).to have_http_status(:unprocessable_entity)
    end
  end
end
