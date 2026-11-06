# frozen_string_literal: true

require "rails_helper"
require_relative "../../../../support/payroll_clock_helpers"

RSpec.describe "Payroll late-hours supplemental batches", type: :request do
  include PayrollClockHelpers

  let(:actor) { create(:user, :admin, is_active: true, personal_access_enabled: true) }
  let(:worker) { create(:user, :employee) }
  let(:category) { create(:time_category) }
  let(:guam) { ActiveSupport::TimeZone["Pacific/Guam"] }
  let(:dates) { payroll_calendar_at(database_clock) }
  let(:grant) { PayrollIntegrationGrant.issue!(user: actor, capabilities: [ "settlement_case_management" ]) }
  let(:secret) { "late-hours-test-secret" }

  around do |example|
    previous_secret = ENV["PAYROLL_SHARED_SECRET"]
    ENV["PAYROLL_SHARED_SECRET"] = secret
    example.run
  ensure
    ENV["PAYROLL_SHARED_SECRET"] = previous_secret
  end

  let(:headers) do
    { "X-Payroll-Shared-Secret" => secret,
      "X-Aire-Delegation-Token" => grant.issued_token, "Content-Type" => "application/json" }
  end
  let(:source) do
    create(:time_entry, user: worker, time_category: category, work_date: dates[:start_date] + 2.days,
      start_time: guam.local(2000, 1, 1, 8), end_time: guam.local(2000, 1, 1, 12),
      entry_method: "manual", status: "completed", approval_status: "pending", overtime_status: "none")
  end
  let(:origin) do
    source
    period = create(:payroll_calendar_period, **payroll_calendar_at(capture_payroll_cutoff))
    wait_for_database_cutoff(period.cutoff_at)
    expect(Payroll::ScheduledCutoffFinalizer.new(period_id: period.id).call[:status]).to eq("finalized")
    period.reload
  end
  let(:held) { origin; PayrollSettlementCase.find_by!(source_time_entry_id: source.id) }
  let(:path) { "/api/v1/payroll/cockpit/periods/#{origin.external_pay_period_id}/late_hours" }

  def approve!
    held
    TimeClockService.approve_entry(entry: source.reload, approved_by: actor, note: "Verified four hours after cutoff")
  end

  def json
    response.parsed_body
  end

  def payload
    { command_id: SecureRandom.uuid, expected_version: origin.reload.lock_version,
      reason: "Pay approved late hours in a separate adjustment", target_external_pay_period_id: "901",
      pay_date: database_clock.to_date.iso8601, cases: [ { id: held.public_id, version: held.reload.lock_version } ] }
  end

  def claim!(parameters = payload)
    post path, params: parameters.to_json, headers: headers
  end

  def receipt!(batch, row, status:, index: 0, target: "901")
    post "/api/v1/payroll/batches/#{batch.public_id}/processing_events", params: {
      event_id: SecureRandom.uuid, status: status, occurred_at: Time.current.iso8601(6),
      external_system: "cornerstone_payroll", external_pay_period_id: target, external_payroll_item_id: "1001",
      source_time_entry_id: row.source_time_entry_id.to_s, source_user_uuid: row.source_user_uuid,
      contract_version: PayrollEntryProcessingEvent::LINE_CONTRACT_VERSION,
      source_line_key: row.line_key, source_kind: row.source_kind,
      total_hours: row.total_hours.to_s, regular_hours: row.regular_hours.to_s, overtime_hours: row.overtime_hours.to_s,
      payment_method: status == "payment_issued" ? "paper_check" : nil,
      payment_reference: status == "payment_issued" ? "SYNTHETIC-#{index}" : nil
    }.to_json, headers: headers
    expect(response).to have_http_status(:created)
  end

  it "lists live payable lines, claims four hours once, preserves cutoff, and waits for exact issuance" do
    approve!
    original = origin.payroll_batch.attributes
    get path, headers: headers
    expect(response).to have_http_status(:ok)
    expect(json["period_version"]).to eq(origin.lock_version)
    candidate = json.fetch("cases").sole
    expect(candidate).to include("id" => held.public_id, "version" => held.reload.lock_version,
      "total_hours" => 4.0, "regular_hours" => 4.0, "overtime_hours" => 0.0)
    expect(candidate.dig("employee", "payroll_integration_id")).to eq(worker.payroll_integration_uuid)
    expect(candidate.fetch("reason")).to be_present
    expect(candidate.fetch("adjustments").sole).to include("source_kind" => "carryover",
      "source_time_entry_version" => source.reload.lock_version, "source_category_id" => category.id.to_s)
    request_body = payload
    expect { claim!(request_body) }.to change(PayrollBatch, :count).by(1)
    expect(response).to have_http_status(:created)
    snapshot = json.fetch("payroll_batch")
    batch = PayrollBatch.find_by!(public_id: snapshot.fetch("batch_id"))
    expect(snapshot).to include("purpose" => "supplemental", "target_external_pay_period_id" => "901", "schema_version" => "2.0")
    expect(batch.checksum).to eq(Payroll::CanonicalPayload.checksum(batch.payload))
    expect(held.reload).to have_attributes(status: "in_payroll", destination_kind: "supplemental", included_payroll_batch_id: batch.id)
    expect(origin.payroll_batch.reload.attributes).to eq(original)
    expect(batch.payroll_batch_entries.sum(:total_hours)).to eq(4)
    row = batch.payroll_batch_entries.sole
    receipt!(batch, row, status: "committed")
    expect(Payroll::SettlementCaseCompletion.new(settlement_case: held.reload, entry: source.reload).call).to be_nil
    # Even a generic case acknowledgement cannot bypass exact-line evidence.
    post "/api/v1/payroll/cockpit/settlement_cases/#{held.public_id}/acknowledge", params: {
      command_id: SecureRandom.uuid, expected_version: held.lock_version, reason: "Attempt generic acknowledgement",
      event_type: "imported", occurred_at: Time.current.iso8601
    }.to_json, headers: headers
    expect(response).to have_http_status(:unprocessable_entity)
    receipt!(batch, row, status: "payment_issued")
    expect(Payroll::SettlementCaseCompletion.new(settlement_case: held.reload, entry: source.reload).call).to eq("paid")
    expect { claim!(request_body) }.not_to change(PayrollBatch, :count)
    expect(response).to have_http_status(:created)
    expect(json["payroll_batch"]).to eq(snapshot)
    expect(json.dig("command", "replayed")).to be(true)
    claim!(request_body.merge(pay_date: "2026-12-01"))
    expect(response).to have_http_status(:conflict)
    get path, headers: headers
    expect(json["cases"]).to eq([])
    get "/api/v1/payroll/batches", params: { start_date: origin.start_date, end_date: origin.end_date }, headers: headers
    expect(json.fetch("payroll_batches").map { |item| item["id"] }).to eq([ origin.payroll_batch.public_id ])
    expect(origin.payroll_batch.reload.attributes).to eq(original)
  end

  it "requires the shared secret and settlement capability" do
    get path
    expect(response).to have_http_status(:unauthorized)
    insufficient = PayrollIntegrationGrant.issue!(user: actor, capabilities: [ "time_approval" ])
    wrong_headers = headers.merge("X-Aire-Delegation-Token" => insufficient.issued_token)
    get path, headers: wrong_headers
    expect(response).to have_http_status(:forbidden)
    claim_body = payload
    post path, params: claim_body.to_json, headers: wrong_headers
    expect(response).to have_http_status(:forbidden)
    expect(PayrollBatch.count).to eq(1)
  end

  it "rejects stale case and period versions without reserving anything" do
    approve!
    claim!(payload.deep_merge(cases: [ { id: held.public_id, version: held.lock_version + 1 } ]))
    expect(response).to have_http_status(:conflict)
    claim!(payload.merge(expected_version: origin.lock_version + 1))
    expect(response).to have_http_status(:conflict)
    expect(PayrollBatch.count).to eq(1)
    expect(held.reload.status).to eq("open")
    expect(PayrollIntegrationCommand.count).to eq(0)
  end

  it "invalidates the displayed case version when its source changes" do
    approve!
    saved = payload
    source.reload.update!(description: "Changed since the displayed selection")
    claim!(saved)
    expect(response).to have_http_status(:conflict)
    expect(PayrollBatch.count).to eq(1)
  end

  %w[pending denied reserved attested routed not_payable included represented wrong_origin].each do |kind|
    it "excludes and atomically rejects #{kind} sources" do
      approve! unless kind == "pending"
      case kind
      when "denied" then source.update!(approval_status: "denied")
      when "reserved"
        PayrollManualAllocation.create!(time_entry: source, user: worker, time_category: category, recorded_by: actor,
          pay_date: database_clock.to_date, external_pay_period_id: "902", external_payroll_item_id: "1002", reason: "Reserved elsewhere",
          source_user_uuid: worker.payroll_integration_uuid, source_time_entry_version: source.lock_version,
          work_date: source.work_date, regular_hours: 4, overtime_hours: 0)
      when "attested"
        PayrollPaymentAttestation.create!(time_entry: source, user: worker, recorded_by: actor,
          source_user_uuid: worker.payroll_integration_uuid, source_time_entry_version: source.lock_version,
          work_date: source.work_date, hours: 4, reason: "Payment reported elsewhere", attested_at: Time.current)
      when "routed", "not_payable"
        Payroll::SettlementCaseRouter.new(settlement_case: held, destination_kind: kind == "routed" ? "supplemental" : "not_payable",
          target_external_pay_period_id: "902", action_due_on: database_clock.to_date, assigned_to_id: nil,
          reason: "Already reviewed and routed", actor: actor).call
      when "included"
        held.reload.update!(destination_kind: "supplemental", target_external_pay_period_id: "902", status: "in_payroll",
          included_payroll_batch: origin.payroll_batch)
      when "represented"
        other = create(:payroll_batch)
        other.payroll_batch_entries.create!(source_time_entry_id: source.id, source_user_id: worker.id,
          source_user_uuid: worker.payroll_integration_uuid, source_category_id: category.id, work_date: source.work_date,
          week_start: source.work_date.beginning_of_week(:sunday), total_hours: 1, regular_hours: 1, overtime_hours: 0,
          source_kind: "current", line_key: "already-covered", snapshot: {})
      when "wrong_origin"
        held.reload.update!(origin_payroll_batch: create(:payroll_batch))
      end
      get path, headers: headers
      expect(response).to have_http_status(:ok)
      expect(json["cases"]).to eq([])
      before = PayrollBatch.count
      claim!
      expect(response).to have_http_status(:conflict)
      expect(PayrollBatch.count).to eq(before)
      expect(PayrollIntegrationCommand.count).to eq(0)
    end
  end

  it "rejects duplicate selected IDs and invalid destination IDs" do
    approve!
    body = payload
    claim!(body.merge(cases: body[:cases] * 2))
    expect(response).to have_http_status(:unprocessable_entity)
    claim!(body.merge(target_external_pay_period_id: "not-an-adjustment"))
    expect(response).to have_http_status(:unprocessable_entity)
    expect(PayrollBatch.count).to eq(1)
  end

  it "protects an included case from the old route endpoint" do
    approve!
    claim!
    expect(response).to have_http_status(:created)
    before = held.reload.attributes
    post "/api/v1/payroll/cockpit/settlement_cases/#{held.public_id}/route", params: {
      command_id: SecureRandom.uuid, expected_version: held.lock_version, reason: "Try to release a reserved obligation",
      destination_kind: "not_payable"
    }.to_json, headers: headers
    expect(response).to have_http_status(:unprocessable_entity)
    expect(held.reload.attributes).to eq(before)
  end

  it "includes all overnight split dates and requires an issued receipt for every exact line" do
    from = payroll_time(dates[:end_date], hour: 22)
    source.update!(entry_method: "clock", work_date: dates[:end_date], start_time: from, end_time: from + 4.hours,
      clock_in_at: from, clock_out_at: from + 4.hours)
    approve!
    claim!
    expect(response).to have_http_status(:created)
    batch = held.reload.included_payroll_batch
    rows = batch.payroll_batch_entries.order(:work_date).to_a
    expect(rows.map(&:work_date)).to eq([ dates[:end_date], dates[:end_date] + 1.day ])
    expect(rows.map(&:total_hours)).to eq([ 2, 2 ])
    expect(rows.map(&:source_kind).uniq).to eq([ "carryover" ])
    receipt!(batch, rows.first, status: "payment_issued", index: 1)
    expect(Payroll::SettlementCaseCompletion.new(settlement_case: held.reload, entry: source.reload).call).to be_nil
    receipt!(batch, rows.last, status: "payment_issued", index: 2)
    expect(Payroll::SettlementCaseCompletion.new(settlement_case: held.reload, entry: source.reload).call).to eq("paid")
  end

  it "rolls back a multi-case selection when any source is unpayable" do
    approve!
    other = create(:time_entry, user: worker, time_category: category, work_date: source.work_date + 1.day,
      entry_method: "manual", status: "completed", approval_status: "pending", overtime_status: "none")
    other_case = create(:payroll_settlement_case, origin_payroll_batch: origin.payroll_batch,
      source_time_entry_id: other.id, source_time_entry_version: other.lock_version, original_work_date: other.work_date,
      source_user_id: worker.id, source_user_uuid: worker.payroll_integration_uuid)
    body = payload
    body[:cases] << { id: other_case.public_id, version: other_case.lock_version }
    claim!(body)
    expect(response).to have_http_status(:conflict)
    expect(PayrollBatch.count).to eq(1)
    expect(held.reload).to have_attributes(status: "open", destination_kind: "unassigned", included_payroll_batch_id: nil)
    expect(other_case.reload.status).to eq("open")
    expect(PayrollIntegrationCommand.count).to eq(0)
  end

  it "exports both selected sources and leaves unselected live context out of the snapshot" do
    approve!
    other = create(:time_entry, user: worker, time_category: category, work_date: source.work_date + 1.day,
      entry_method: "manual", status: "completed", approval_status: "approved", approved_at: Time.current, overtime_status: "none")
    other_case = create(:payroll_settlement_case, origin_payroll_batch: origin.payroll_batch,
      source_time_entry_id: other.id, source_time_entry_version: other.lock_version, original_work_date: other.work_date,
      source_user_id: worker.id, source_user_uuid: worker.payroll_integration_uuid)
    create(:time_entry, user: worker, time_category: category, work_date: source.work_date + 2.days,
      entry_method: "manual", status: "completed", approval_status: "approved", approved_at: Time.current, overtime_status: "none")
    body = payload
    body[:cases] << { id: other_case.public_id, version: other_case.lock_version }
    eligibility_queries = []
    subscriber = lambda do |_name, _start, _finish, _id, event|
      sql = event[:sql]
      if sql.include?('"payroll_settlement_cases"') && sql.include?('"payroll_manual_allocations"') && sql.include?("NOT IN")
        eligibility_queries << sql
      end
    end
    ActiveSupport::Notifications.subscribed(subscriber, "sql.active_record") { claim!(body) }
    expect(eligibility_queries.size).to eq(1), "Expected one eligibility query while the source ledger is locked; got #{eligibility_queries.size}"
    expect(response).to have_http_status(:created)
    employee = json.fetch("payroll_batch").fetch("employees").sole
    expect(employee).to include("source_user_uuid" => worker.payroll_integration_uuid, "source_user_id" => worker.id.to_s)
    expect(employee.fetch("adjustments").map { |row| row["source_time_entry_id"] }.sort).to eq([ source.id.to_s, other.id.to_s ].sort)
    expect(employee["total_hours"]).to eq(12)
    expect(other_case.reload.included_payroll_batch_id).to eq(held.reload.included_payroll_batch_id)
    # Later ordinary live review sees the same ledger balance, not new wages.
    ordinary = Payroll::BatchBuilder.new(start_date: origin.start_date, end_date: origin.end_date).call
    expect(ordinary[:rows].select { |row| [ source.id, other.id ].include?(row[:source_time_entry_id]) }).to eq([])
  end

  it "uses live whole-week overtime context while exporting only the selected source" do
    # Put the late source after five approved eight-hour shifts in one week.
    saturday = dates[:start_date] + ((6 - dates[:start_date].wday) % 7)
    source.update!(work_date: saturday)
    5.times do |index|
      create(:time_entry, user: worker, time_category: category, work_date: saturday - 5.days + index.days,
        entry_method: "manual", status: "completed", approval_status: "approved", approved_at: Time.current, overtime_status: "none")
    end
    approve!
    TimeClockService.approve_overtime(entry: source.reload, approved_by: actor, note: "Reviewed full source workweek")
    get path, headers: headers
    expect(response).to have_http_status(:ok)
    expect(json.fetch("cases").sole).to include("regular_hours" => 0.0, "overtime_hours" => 4.0)
    claim!
    expect(response).to have_http_status(:created)
    employee = json.fetch("payroll_batch").fetch("employees").sole
    expect(employee.fetch("adjustments").sole).to include("source_time_entry_id" => source.id.to_s,
      "regular_hours" => 0.0, "overtime_hours" => 4.0)
  end

  it "rejects wrong-target exact receipts for the supplemental obligation" do
    approve!
    claim!
    expect(response).to have_http_status(:created)
    batch = held.reload.included_payroll_batch
    row = batch.payroll_batch_entries.sole
    post "/api/v1/payroll/batches/#{batch.public_id}/processing_events", params: {
      event_id: SecureRandom.uuid, status: "payment_issued", occurred_at: Time.current.iso8601(6),
      external_system: "cornerstone_payroll", external_pay_period_id: "wrong-target", external_payroll_item_id: "1001",
      source_time_entry_id: row.source_time_entry_id.to_s, source_user_uuid: row.source_user_uuid,
      contract_version: PayrollEntryProcessingEvent::LINE_CONTRACT_VERSION,
      source_line_key: row.line_key, source_kind: row.source_kind,
      total_hours: row.total_hours.to_s, regular_hours: row.regular_hours.to_s, overtime_hours: row.overtime_hours.to_s,
      payment_method: "paper_check", payment_reference: "SYNTHETIC-WRONG-TARGET"
    }.to_json, headers: headers
    expect(response).to have_http_status(:conflict)
    expect(PayrollEntryProcessingEvent.count).to eq(0)
  end

  it "keeps regular overlap and date uniqueness scoped to regular batches" do
    approve!
    future_dates = payroll_calendar_for(next_payroll_start(origin.start_date))
    supplemental = create(:payroll_batch, start_date: future_dates[:start_date], end_date: future_dates[:end_date],
      payload: { purpose: "supplemental", target_external_pay_period_id: "902" })
    period = create(:payroll_calendar_period, **future_dates)
    expect(period).to be_persisted
    # The ordinary finalizer's exact-date overlap guard ignores supplemental snapshots.
    finalizer = Payroll::BatchFinalizer.new(start_date: period.start_date, end_date: period.end_date, actor: actor)
    expect { finalizer.send(:reject_overlapping_batch!) }.not_to raise_error
    regular = create(:payroll_batch, start_date: supplemental.start_date, end_date: supplemental.end_date)
    expect { finalizer.send(:reject_overlapping_batch!) }.to raise_error(Payroll::BatchFinalizer::ExistingBatchError)
    expect(PayrollBatch.regular.where(id: [ regular.id, supplemental.id ]).pluck(:id)).to eq([ regular.id ])
  end

  it "replays its saved export envelope after integration capabilities change" do
    approve!
    request_body = payload
    claim!(request_body)
    expect(response).to have_http_status(:created)
    snapshot = json.fetch("payroll_batch")
    allow(Payroll::IntegrationProfile).to receive(:call).and_return({ changed_capabilities: true })
    claim!(request_body)
    expect(response).to have_http_status(:created)
    expect(json.fetch("payroll_batch")).to eq(snapshot)
  end

  it "does not permit a second command to attach another batch to the same adjustment" do
    approve!
    claim!
    expect(response).to have_http_status(:created)
    claim!(payload.merge(command_id: SecureRandom.uuid))
    expect(response).to have_http_status(:conflict)
    expect(PayrollBatch.count).to eq(2)
    expect(PayrollIntegrationCommand.count).to eq(1)
  end

  it "rejects batch-level payment claims and exact issuance without payment evidence" do
    approve!
    claim!
    expect(response).to have_http_status(:created)
    batch = held.reload.included_payroll_batch
    row = batch.payroll_batch_entries.sole
    base = { event_id: SecureRandom.uuid, status: "payment_issued", occurred_at: Time.current.iso8601(6),
      external_system: "cornerstone_payroll", external_pay_period_id: "901" }
    post "/api/v1/payroll/batches/#{batch.public_id}/processing_events", params: base.to_json, headers: headers
    expect(response).to have_http_status(:unprocessable_entity)
    post "/api/v1/payroll/batches/#{batch.public_id}/processing_events", params: base.merge(
      source_time_entry_id: row.source_time_entry_id.to_s, source_user_uuid: row.source_user_uuid,
      external_payroll_item_id: "1001", contract_version: "2.0", source_line_key: row.line_key, source_kind: row.source_kind,
      total_hours: row.total_hours.to_s, regular_hours: row.regular_hours.to_s, overtime_hours: row.overtime_hours.to_s
    ).to_json, headers: headers
    expect(response).to have_http_status(:conflict)
    expect(PayrollEntryProcessingEvent.count).to eq(0)
    expect(PayrollBatchProcessingEvent.count).to eq(0)
  end

  it "completes legacy source rows whose category the builder resolves from a sole active assignment" do
    approve!
    worker.assigned_time_categories << category
    # Simulate existing legacy data; new completed entries require a category.
    source.update_columns(time_category_id: nil)
    get path, headers: headers
    expect(json.fetch("cases").sole.fetch("adjustments").sole["source_category_id"]).to eq(category.id.to_s)
    claim!
    expect(response).to have_http_status(:created)
    batch = held.reload.included_payroll_batch
    receipt!(batch, batch.payroll_batch_entries.sole, status: "payment_issued")
    expect(Payroll::SettlementCaseCompletion.new(settlement_case: held.reload, entry: source.reload).call).to eq("paid")
  end

  it "defers a supplemental claim while a due regular cutoff still owns positive frozen split hours" do
    from = payroll_time(dates[:end_date], hour: 22)
    source.update!(entry_method: "clock", work_date: dates[:end_date], start_time: from, end_time: from + 4.hours,
      clock_in_at: from, clock_out_at: from + 4.hours)
    approve!
    cutoff = capture_payroll_cutoff
    next_dates = payroll_calendar_for(next_payroll_start(origin.start_date))
    payday = next_dates[:end_date] + 1.day
    due = create(:payroll_calendar_period, **next_dates.merge(pay_date: payday, cutoff_at: cutoff,
      next_finalization_attempt_at: cutoff), schema_version: "2.0", cutoff_rule: "before_pay_date",
      cutoff_days: (payday - cutoff.to_date).to_i)
    wait_for_database_cutoff(cutoff)
    # Source changed after the due snapshot: claiming today's six hours must
    # not make its delayed regular finalizer reverse or duplicate frozen work.
    source.update!(end_time: from + 6.hours, clock_out_at: from + 6.hours, approval_status: "pending", approved_at: nil, approved_by: nil)
    TimeClockService.approve_entry(entry: source.reload, approved_by: actor, note: "Reviewed later source correction")
    body = payload
    claim!(body)
    expect(response).to have_http_status(:conflict)
    expect(json.fetch("error")).to include(due.external_pay_period_id, "cutoff")
    expect(PayrollBatch.count).to eq(1)
    get path, headers: headers
    expect(json.fetch("cases")).to eq([])
  end
end
