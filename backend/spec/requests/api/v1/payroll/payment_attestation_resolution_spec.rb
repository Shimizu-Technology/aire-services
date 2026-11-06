# frozen_string_literal: true

require "rails_helper"

RSpec.describe "Reported payment resolution", type: :request do
  let(:secret) { "reported-payment-resolution-test-secret" }
  let(:actor) { create(:user, :admin, is_active: true, personal_access_enabled: true) }
  let(:employee) { create(:user, :employee) }
  let(:category) { create(:time_category) }
  let(:entry) do
    create(:time_entry, user: employee, time_category: category, work_date: Date.new(2026, 8, 15),
      entry_method: "manual", status: "completed", approval_status: "approved", overtime_status: "none")
  end
  let(:report) do
    Payroll::PaymentAttestationRecorder.new(actor: actor).attest!(entry: entry,
      source_user_uuid: employee.payroll_integration_uuid,
      reason: "Owner reported this work paid; exact saved check evidence still needs matching")
  end
  let(:grant) { PayrollIntegrationGrant.issue!(user: actor, capabilities: %w[settlement_case_management]) }
  let(:headers) do
    { "X-Payroll-Shared-Secret" => secret, "X-Aire-Delegation-Token" => grant.issued_token,
      "X-Payroll-Source-Instance-Id" => Payroll::IntegrationProfile.source_instance_id,
      "Content-Type" => "application/json" }
  end
  let(:path) { "/api/v1/payroll/cockpit/payment_attestations/#{report.id}/resolve" }
  let(:context) { Payroll::PaymentAttestationResolutionContext.new(attestation: report).call }
  let(:payload) do
    { command_id: SecureRandom.uuid, expected_version: report.lock_version,
      source_time_entry_id: entry.id.to_s, source_time_entry_version: entry.lock_version,
      source_user_uuid: employee.payroll_integration_uuid, work_date: entry.work_date.iso8601,
      regular_hours: context.fetch(:regular_hours), overtime_hours: context.fetch(:overtime_hours),
      expected_weekly_context_fingerprint: context.fetch(:weekly_context_fingerprint),
      external_pay_period_id: "adjustment-68", external_payroll_item_id: "issued-item-1438", pay_date: "2026-09-17",
      payment_method: "paper_check", payment_reference: "SYNTHETIC-01045", payment_effective_on: "2026-09-16",
      occurred_at: "2026-09-17T15:00:00+10:00", payroll_payment_event_type: "delivered_check",
      payroll_payment_event_id: "synthetic-delivery-event-77", reason: "Reviewed the exact existing issued payroll item and its recorded check delivery" }
  end

  around do |example|
    previous = ENV["PAYROLL_SHARED_SECRET"]
    ENV["PAYROLL_SHARED_SECRET"] = secret
    example.run
  ensure
    ENV["PAYROLL_SHARED_SECRET"] = previous
  end

  def resolve(**changes)
    post path, params: payload.merge(changes).to_json, headers: headers
  end

  def body
    response.parsed_body
  end

  it "exposes exact Source classification and a bounded weekly proof without sibling identity data" do
    report
    get "/api/v1/payroll/cockpit/payment_attestations", params: { source_user_uuid: employee.payroll_integration_uuid }, headers: headers
    expect(response).to have_http_status(:ok)
    proof = body.fetch("payment_attestations").sole.fetch("resolution_context")
    expect(proof).to include("available" => true, "reason" => nil, "regular_hours" => "8.0", "overtime_hours" => "0.0", "total_hours" => "8.0")
    expect(proof.fetch("weekly_context_fingerprint")).to match(/\A[0-9a-f]{64}\z/)
    expect(proof.keys).to contain_exactly("available", "reason", "regular_hours", "overtime_hours", "total_hours", "weekly_context_fingerprint")
    expect(Payroll::IntegrationProfile::CAPABILITIES).to include("payment_attestation_resolution_v1")
  end

  it "scopes original report work dates before pagination without losing boundary reports or employee isolation" do
    report
    dated_reports = [ Date.new(2026, 7, 31), Date.new(2026, 8, 1), Date.new(2026, 8, 16) ].map do |date|
      dated_entry = create(:time_entry, user: employee, time_category: category, work_date: date,
        entry_method: "manual", status: "completed", approval_status: "approved", overtime_status: "none")
      Payroll::PaymentAttestationRecorder.new(actor: actor).attest!(entry: dated_entry,
        source_user_uuid: employee.payroll_integration_uuid, reason: "Original owner report retained for exact payment evidence review")
    end
    other_employee = create(:user, :employee)
    other_entry = create(:time_entry, user: other_employee, time_category: category, work_date: entry.work_date,
      entry_method: "manual", status: "completed", approval_status: "approved", overtime_status: "none")
    Payroll::PaymentAttestationRecorder.new(actor: actor).attest!(entry: other_entry,
      source_user_uuid: other_employee.payroll_integration_uuid, reason: "Different employee report must remain outside this scoped review")
    parameters = { source_user_uuid: employee.payroll_integration_uuid, start_date: "2026-08-01", end_date: "2026-08-15", per_page: 1 }
    get "/api/v1/payroll/cockpit/payment_attestations", params: parameters, headers: headers
    expect(response).to have_http_status(:ok)
    expect(body.fetch("payment_attestations").pluck("id")).to eq([ dated_reports[1].id.to_s ])
    expect(body.fetch("pagination")).to include("total_count" => 2, "total_pages" => 2, "current_page" => 1, "truncated" => true)
    get "/api/v1/payroll/cockpit/payment_attestations", params: parameters.merge(page: 2), headers: headers
    expect(body.fetch("payment_attestations").pluck("id")).to eq([ report.id.to_s ])
    expect(body.fetch("pagination")).to include("total_count" => 2, "current_page" => 2, "truncated" => false)
    get "/api/v1/payroll/cockpit/payment_attestations", params: { source_user_uuid: employee.payroll_integration_uuid }, headers: headers
    expect(body.fetch("payment_attestations").pluck("id")).to contain_exactly(report.id.to_s, *dated_reports.map { |row| row.id.to_s })
  end

  it "rejects incomplete, malformed, or reversed report date filters without changing history" do
    report
    [ { start_date: "2026-08-01" }, { end_date: "2026-08-15" },
      { start_date: "", end_date: "2026-08-15" }, { start_date: "2026-02-30", end_date: "2026-08-15" },
      { start_date: "20260801", end_date: "2026-08-15" }, { start_date: [ "2026-08-01" ], end_date: "2026-08-15" },
      { start_date: "2026-08-16", end_date: "2026-08-15" } ].each do |filter|
      expect do
        get "/api/v1/payroll/cockpit/payment_attestations", params: filter, headers: headers
      end.not_to change(PayrollPaymentAttestation, :count)
      expect(response).to have_http_status(:unprocessable_entity)
      expect(body.fetch("error")).to include("Provide both start_date and end_date")
    end
  end

  it "preserves non-date policy errors from report serialization with or without valid date filters" do
    original = report.attributes
    allow_any_instance_of(Payroll::PaymentAttestationResolutionContext).to receive(:snapshot!)
      .and_raise(Payroll::BatchBuilder::PolicyUnavailableError, "Published overtime policy requires review")

    [ {}, { start_date: "2026-08-01", end_date: "2026-08-15" } ].each do |filter|
      get "/api/v1/payroll/cockpit/payment_attestations", params: filter, headers: headers
      expect(response).to have_http_status(:unprocessable_entity)
      expect(body).to include("error" => "Published overtime policy requires review", "review_required" => true)
      expect(report.reload.attributes).to eq(original)
    end
  end

  it "audits missing revision coverage while rejecting a reported-payment match without changing its history" do
    payload
    # A retained legacy entry can predate the append-only revision capture.
    TimeEntry.insert_all!([ entry.attributes.except("id").merge("description" => "Legacy work without captured revision history") ])
    original_report = report.reload.attributes
    original_entry = entry.reload.attributes
    original_history = [ PayrollPaymentAttestationEvent.count, PayrollManualAllocation.count,
      PayrollManualAllocationEvent.count, PayrollIntegrationCommand.count ]

    expect do
      resolve
    end.to change { AuditLog.where(action: "payroll_cockpit.command_rejected", outcome: "failed").count }.by(1)

    expect(response).to have_http_status(:unprocessable_entity)
    expect(body.fetch("error")).to include("Revision history does not cover this cutoff")
    expect(report.reload.attributes).to eq(original_report)
    expect(entry.reload.attributes).to eq(original_entry)
    expect([ PayrollPaymentAttestationEvent.count, PayrollManualAllocation.count,
      PayrollManualAllocationEvent.count, PayrollIntegrationCommand.count ]).to eq(original_history)
    audit = AuditLog.find_by!(action: "payroll_cockpit.command_rejected", auditable: report)
    expect(audit).to have_attributes(user_id: actor.id, correlation_id: payload.fetch(:command_id), outcome: "failed")
    expect(audit.metadata).to include("command_action" => "resolve", "error" => body.fetch("error"))
  end

  it "retains the correct report and atomically records full issued coverage across payroll periods" do
    original = report.reload.attributes.slice("reason", "attested_at", "source_time_entry_version", "hours", "work_date")
    expect(context.fetch(:available)).to be(true)
    get "/api/v1/payroll/cockpit/payment_attestations", params: { source_user_uuid: employee.payroll_integration_uuid }, headers: headers
    indexed_attested_at = body.fetch("payment_attestations").sole.fetch("attested_at")
    resolve
    expect(response).to have_http_status(:ok), response.body
    receipt = body.fetch("command_result")
    allocation = PayrollManualAllocation.sole
    issue = allocation.payroll_manual_allocation_events.where(event_type: "issued").sole
    expect(report.reload.attributes.slice(*original.keys)).to eq(original)
    expect(report).to have_attributes(status: "resolved", retracted_at: nil, retracted_by_id: nil,
      resolved_manual_allocation_id: allocation.id, resolved_issued_event_id: issue.id)
    expect(report.payroll_payment_attestation_events.pluck(:event_type)).to eq(%w[attested resolved])
    expect(allocation).to have_attributes(status: "issued", regular_hours: 8, overtime_hours: 0,
      external_pay_period_id: "adjustment-68", external_payroll_item_id: "issued-item-1438")
    expect(allocation.payroll_manual_allocation_events.pluck(:event_type)).to eq(%w[committed issued])
    expect(receipt).to include("expected_version" => 0, "result_version" => 1, "status" => "resolved",
      "manual_allocation_expected_version" => 0, "manual_allocation_result_version" => 1,
      "expected_weekly_context_fingerprint" => payload.fetch(:expected_weekly_context_fingerprint),
      "payroll_payment_event_id" => "synthetic-delivery-event-77")
    expect(body.fetch("manual_allocation")).to eq(receipt.fetch("manual_allocation"))
    expect(body.fetch("payment_attestation")).to eq(receipt.fetch("payment_attestation"))
    expect(receipt.fetch("payment_attestation").fetch("attested_at")).to eq(indexed_attested_at)
    expect(body.fetch("integration")).to eq(receipt.fetch("integration"))
    expect(receipt.to_json).not_to include(original.fetch("reason"), payload.fetch(:reason))
    lifecycle = Payroll::EntryLifecycleResolver.new(entries: [ entry ]).call.fetch(entry.id)
    expect(lifecycle).to include(status: "payment_issued", manually_paid_hours: 8.0)
    expect(lifecycle.fetch(:resolved_payment_report)).to include(id: report.id.to_s, reason: original.fetch("reason"))
    totals = Payroll::EmployeePeriodEvidence.new(user: employee).call.fetch(:totals)
    expect(totals).to include(issued_hours: 8.0, held_hours: 0.0, needs_reconciliation_hours: 0.0)
    expect(Payroll::BatchBuilder.new(start_date: "2026-08-01", end_date: "2026-08-15").call.dig(:summary, :total_hours)).to eq(0.0)
  end

  it "preserves the saved receipt for exact retries after cancellation and current capability changes" do
    resolve
    expect(response).to have_http_status(:ok)
    original = body.except("command")
    allocation = PayrollManualAllocation.sole
    post "/api/v1/payroll/cockpit/manual_allocations/#{allocation.id}/cancel_payment", params: {
      command_id: SecureRandom.uuid, expected_version: allocation.lock_version, payment_method: "paper_check",
      payment_reference: "SYNTHETIC-01045", payment_effective_on: "2026-09-16", occurred_at: Time.current.iso8601(6),
      cancellation_evidence_reference: "synthetic-bank-stop-77", reason: "Verified bank nonpayment before retiring this exact instrument"
    }.to_json, headers: headers
    expect(response).to have_http_status(:ok)
    allow(Payroll::IntegrationProfile).to receive(:call).and_return(Payroll::IntegrationProfile.call.merge(capabilities: []))
    expect { resolve }.not_to change(PayrollManualAllocationEvent, :count)
    expect(response).to have_http_status(:ok)
    expect(body.fetch("command")).to include("id" => payload.fetch(:command_id), "replayed" => true)
    expect(body.except("command")).to eq(original)
    expect(report.reload.status).to eq("resolved")
    expect(allocation.reload.status).to eq("committed")
    expect(Payroll::EntryLifecycleResolver.new(entries: [ entry ]).call.dig(entry.id, :status)).to eq("payment_cancelled")
    expect(Payroll::BatchBuilder.new(start_date: "2026-08-01", end_date: "2026-08-15").call.dig(:summary, :total_hours)).to eq(0.0)
  end

  it "rejects a changed retry payload and a second command rather than replacing the original match" do
    resolve
    original_count = PayrollIntegrationCommand.count
    resolve(payment_reference: "ANOTHER-CHECK")
    expect(response).to have_http_status(:conflict)
    resolve(command_id: SecureRandom.uuid)
    expect(response).to have_http_status(:conflict)
    expect(PayrollIntegrationCommand.count).to eq(original_count)
    expect(PayrollManualAllocation.count).to eq(1)
  end

  it "requires actor delegation and the correct pinned installation before any write" do
    post path, params: payload.to_json, headers: headers.except("X-Aire-Delegation-Token")
    expect(response).to have_http_status(:unauthorized)
    bad_grant = PayrollIntegrationGrant.issue!(user: actor, capabilities: %w[time_approval])
    post path, params: payload.to_json, headers: headers.merge("X-Aire-Delegation-Token" => bad_grant.issued_token)
    expect(response).to have_http_status(:forbidden)
    post path, params: payload.to_json, headers: headers.merge("X-Payroll-Source-Instance-Id" => SecureRandom.uuid)
    expect(response).to have_http_status(:conflict)
    expect(PayrollManualAllocation.count).to eq(0)
    expect(report.reload.status).to eq("pending_evidence")
  end

  it "requires the original report and source versions" do
    resolve(expected_version: 99)
    expect(response).to have_http_status(:conflict)
    resolve(source_time_entry_version: 99)
    expect(response).to have_http_status(:unprocessable_entity)
    [ { source_time_entry_id: "another-entry" }, { source_user_uuid: SecureRandom.uuid },
      { work_date: "2026-08-14" } ].each do |changes|
      resolve(**changes)
      expect(response).to have_http_status(:unprocessable_entity)
    end
    expect(PayrollManualAllocation.count).to eq(0)
  end

  it "rejects partial coverage, wrong classification, or forged context without releasing the hold" do
    [ { regular_hours: "4.00" }, { regular_hours: "7.00", overtime_hours: "1.00" },
      { expected_weekly_context_fingerprint: "0" * 64 }, { regular_hours: "NaN" } ].each do |changes|
      resolve(**changes)
      expect(response.status).to be_in([ 409, 422 ])
      expect(report.reload.status).to eq("pending_evidence")
      expect(PayrollManualAllocation.count).to eq(0)
    end
  end

  it "rejects an edited held entry without retracting or rewriting the correct report" do
    payload
    entry.update!(description: "New source note requiring historical review")
    resolve
    expect(response).to have_http_status(:unprocessable_entity)
    expect(report.reload.status).to eq("pending_evidence")
    expect(PayrollManualAllocation.count).to eq(0)
  end

  it "rejects changed weekly classification even when the held entry version did not change" do
    payload
    original_version = entry.lock_version
    create(:time_entry, user: employee, time_category: category, work_date: entry.work_date - 1.day,
      entry_method: "manual", status: "completed", approval_status: "approved")
    expect(entry.reload.lock_version).to eq(original_version)
    resolve
    expect(response).to have_http_status(:unprocessable_entity)
    expect(body.fetch("error")).to include("source week changed")
    expect(report.reload.status).to eq("pending_evidence")
    expect(PayrollManualAllocation.count).to eq(0)
  end

  it "requires native evidence identity and rejects prepared or future payment evidence" do
    [ { payroll_payment_event_type: "printed_check" }, { payroll_payment_event_id: "" },
      { payroll_payment_event_type: "direct_deposit_confirmation" },
      { occurred_at: 2.days.from_now.iso8601, payment_effective_on: 2.days.from_now.to_date.iso8601 } ].each do |changes|
      resolve(**changes)
      expect(response).to have_http_status(:unprocessable_entity)
      expect(report.reload.status).to eq("pending_evidence")
      expect(PayrollManualAllocation.count).to eq(0)
    end
  end

  it "accepts existing confirmed bank evidence through the same allocation ledger" do
    resolve(payment_method: "direct_deposit", payment_reference: "SYNTHETIC-BANK-77",
      payroll_payment_event_type: "direct_deposit_confirmation", payroll_payment_event_id: "confirmation:77")
    expect(response).to have_http_status(:ok)
    expect(PayrollManualAllocation.sole).to have_attributes(status: "issued", payment_method: "direct_deposit")
  end

  it "preserves a pre-resolution cutoff hold and settles its later captured case with exact issue evidence" do
    old_cutoff = report.attested_at
    period = create(:payroll_calendar_period, start_date: Date.new(2026, 8, 1), end_date: Date.new(2026, 8, 15),
      pay_date: old_cutoff.in_time_zone("Pacific/Guam").to_date + 7.days, cutoff_at: old_cutoff,
      next_finalization_attempt_at: old_cutoff)
    resolve
    expect(response).to have_http_status(:ok)
    expect(PayrollPaymentAttestation.blocking_at(old_cutoff)).to include(report.reload)
    expect(PayrollPaymentAttestation.blocking_at(report.resolved_at)).not_to include(report)
    expect(Payroll::ScheduledCutoffFinalizer.new(period_id: period.id).call.fetch(:status)).to eq("finalized")
    batch = period.reload.payroll_batch
    expect(batch.payroll_batch_entries).to be_empty, {
      rows: batch.payroll_batch_entries.map { |row| row.attributes.slice("source_time_entry_id", "regular_hours", "overtime_hours", "total_hours") },
      cutoff: batch.cutoff_at, resolved_at: report.reload.resolved_at, issues: batch.issues,
      exclusions: batch.payroll_batch_exclusions.pluck(:reason)
    }.inspect
    exclusion = batch.payroll_batch_exclusions.find_by!(source_time_entry_id: entry.id)
    expect(exclusion.reason).to eq("pending_payment_attestation")
    settlement = PayrollSettlementCase.find_by!(origin_payroll_batch_exclusion: exclusion)
    expect(settlement).to have_attributes(status: "settled", target_external_pay_period_id: "adjustment-68")
    closing = settlement.payroll_settlement_case_events.order(:id).last
    expect(closing.metadata.fetch("manual_allocation_component_ids")).to eq([ report.resolved_manual_allocation_id.to_s ])
    checksum = batch.checksum

    allocation = report.resolved_manual_allocation
    post "/api/v1/payroll/cockpit/manual_allocations/#{allocation.id}/cancel_payment", params: {
      command_id: SecureRandom.uuid, expected_version: allocation.lock_version, payment_method: "paper_check",
      payment_reference: "SYNTHETIC-01045", payment_effective_on: "2026-09-16", occurred_at: Time.current.iso8601(6),
      cancellation_evidence_reference: "synthetic-bank-stop-77", reason: "Verified bank nonpayment before retiring this exact instrument"
    }.to_json, headers: headers
    expect(response).to have_http_status(:ok)
    expect(settlement.reload.status).to eq("in_payroll")
    expect(batch.reload.checksum).to eq(checksum)
    expect(report.reload.status).to eq("resolved")
  end

  it "requires the complete authoritative weekly regular and overtime split" do
    4.times do |offset|
      create(:time_entry, user: employee, time_category: category, work_date: Date.new(2026, 8, 9) + offset,
        entry_method: "manual", status: "completed", approval_status: "approved")
    end
    create(:time_entry, user: employee, time_category: category, work_date: Date.new(2026, 8, 13),
      start_time: Time.utc(2000, 1, 1, 0, 0), end_time: Time.utc(2000, 1, 1, 2, 0),
      entry_method: "manual", status: "completed", approval_status: "approved")
    TimeClockService.approve_overtime(entry: entry, approved_by: actor)
    expect(context).to include(available: true, regular_hours: "6.0", overtime_hours: "2.0", total_hours: "8.0")
    resolve(regular_hours: "8.00", overtime_hours: "0.00")
    expect(response).to have_http_status(:unprocessable_entity)
    resolve
    expect(response).to have_http_status(:ok)
    expect(PayrollManualAllocation.sole).to have_attributes(regular_hours: 6, overtime_hours: 2)
  end

  it "settles the previously superseded report case without withdrawing its history" do
    settlement = create(:payroll_settlement_case, source_time_entry_id: entry.id, source_user_id: employee.id,
      source_user_uuid: employee.payroll_integration_uuid, original_work_date: entry.work_date, held_total_hours: 8)
    report
    expect(settlement.reload.status).to eq("superseded")
    resolve
    expect(response).to have_http_status(:ok), response.body
    expect(settlement.reload.status).to eq("settled")
    expect(settlement.payroll_settlement_case_events.order(:id).pluck(:event_type)).to eq(%w[superseded settled])
    expect(settlement.payroll_settlement_case_events.order(:id).last.metadata.fetch("manual_allocation_component_ids"))
      .to eq([ report.reload.resolved_manual_allocation_id.to_s ])
    expect(report.payroll_payment_attestation_events.pluck(:event_type)).to eq(%w[attested resolved])
  end

  [ false, true ].each do |replacement|
    it "retains committed wages when #{replacement ? "replacement cancellation" : "original cancellation"} precedes historical cutoff capture" do
      old_cutoff = report.attested_at
      period = create(:payroll_calendar_period, start_date: Date.new(2026, 8, 1), end_date: Date.new(2026, 8, 15),
        pay_date: old_cutoff.in_time_zone("Pacific/Guam").to_date + 7.days, cutoff_at: old_cutoff,
        next_finalization_attempt_at: old_cutoff)
      resolve
      expect(response).to have_http_status(:ok), response.body
      allocation = PayrollManualAllocation.sole
      post "/api/v1/payroll/cockpit/manual_allocations/#{allocation.id}/cancel_payment", params: {
        command_id: SecureRandom.uuid, expected_version: allocation.lock_version, payment_method: "paper_check",
        payment_reference: "SYNTHETIC-01045", payment_effective_on: "2026-09-16", occurred_at: Time.current.iso8601(6),
        cancellation_evidence_reference: "synthetic-bank-stop-77", reason: "Verified bank nonpayment before retiring this exact instrument"
      }.to_json, headers: headers
      expect(response).to have_http_status(:ok)
      if replacement
        paid_on = Time.current.in_time_zone("Pacific/Guam").to_date.iso8601
        post "/api/v1/payroll/cockpit/manual_allocations/#{allocation.id}/issue", params: {
          command_id: SecureRandom.uuid, expected_version: allocation.reload.lock_version,
          payment_method: "paper_check", payment_reference: "SYNTHETIC-REPLACEMENT-B",
          payment_effective_on: paid_on, occurred_at: Time.current.iso8601(6),
          reason: "Synthetic replacement delivery evidence for the same committed wages"
        }.to_json, headers: headers
        expect(response).to have_http_status(:ok)
        post "/api/v1/payroll/cockpit/manual_allocations/#{allocation.id}/cancel_payment", params: {
          command_id: SecureRandom.uuid, expected_version: allocation.reload.lock_version,
          payment_method: "paper_check", payment_reference: "SYNTHETIC-REPLACEMENT-B",
          payment_effective_on: paid_on, occurred_at: Time.current.iso8601(6),
          cancellation_evidence_reference: "synthetic-bank-stop-replacement-B",
          reason: "Verified cancellation of the latest replacement instrument"
        }.to_json, headers: headers
        expect(response).to have_http_status(:ok)
      end
      expect(Payroll::ScheduledCutoffFinalizer.new(period_id: period.id).call.fetch(:status)).to eq("finalized")
      batch = period.reload.payroll_batch
      expect(batch.payroll_batch_entries).to be_empty
      settlement = PayrollSettlementCase.find_by!(origin_payroll_batch: batch, source_time_entry_id: entry.id)
      expect(settlement.status).to eq("in_payroll")
      reopening = settlement.payroll_settlement_case_events.order(:id).last
      expect(reopening.event_type).to eq("payment_cancelled")
      expect(reopening.metadata.fetch("payment_reference")).to eq(replacement ? "SYNTHETIC-REPLACEMENT-B" : "SYNTHETIC-01045")
      original_issue = allocation.payroll_manual_allocation_events.where(event_type: "issued").order(:id).first
      expect(report.reload.resolved_issued_event_id).to eq(original_issue.id)
      expect(allocation.reload.status).to eq("committed")
      expect(report.reload.status).to eq("resolved")
      expect(Payroll::EntryLifecycleResolver.new(entries: [ entry ]).call.dig(entry.id, :status)).to eq("payment_cancelled")
    end
  end

  it "rolls back allocation, report resolution, events and receipt if settlement synchronization fails" do
    report
    allow(Payroll::SettlementCaseCoordinator).to receive(:resolve_attestation_cases!).and_raise("synthetic settlement failure")
    resolve
    expect(response).to have_http_status(:internal_server_error)
    expect(report.reload.status).to eq("pending_evidence")
    expect(report.payroll_payment_attestation_events.pluck(:event_type)).to eq([ "attested" ])
    expect(PayrollManualAllocation.count).to eq(0)
    expect(PayrollManualAllocationEvent.count).to eq(0)
    expect(PayrollIntegrationCommand.where(command_id: payload.fetch(:command_id))).to be_empty
  end

  it "keeps ordinary manual linking blocked and prevents a software void of resolved issued hours" do
    report
    post "/api/v1/payroll/cockpit/manual_allocations", params: payload.except(:source_time_entry_version)
      .merge(expected_version: entry.lock_version).to_json, headers: headers
    expect(response).to have_http_status(:unprocessable_entity)
    expect(body.fetch("error")).to include("held by an owner payment attestation")
    resolve
    allocation = PayrollManualAllocation.sole
    post "/api/v1/payroll/cockpit/manual_allocations/#{allocation.id}/void", params: {
      command_id: SecureRandom.uuid, expected_version: allocation.lock_version,
      occurred_at: Time.current.iso8601(6), reason: "Software void without verified cancellation proof"
    }.to_json, headers: headers
    expect(response).to have_http_status(:unprocessable_entity)
    expect(allocation.reload.status).to eq("issued")
    expect(report.reload.status).to eq("resolved")
  end

  it "protects the original report and resolution anchors against direct SQL rewriting or deletion" do
    resolve
    [ "UPDATE payroll_payment_attestations SET reason = 'rewritten' WHERE id = #{report.id}",
      "UPDATE payroll_payment_attestations SET resolved_at = clock_timestamp() WHERE id = #{report.id}",
      "DELETE FROM payroll_payment_attestations WHERE id = #{report.id}",
      "TRUNCATE payroll_payment_attestations CASCADE" ].each do |sql|
      expect do
        ApplicationRecord.transaction(requires_new: true) { ApplicationRecord.connection.execute(sql) }
      end.to raise_error(ActiveRecord::StatementInvalid, /immutable|append-only/)
    end
    expect(report.reload.status).to eq("resolved")
  end

  context "when revision history predates this installation's captured coverage" do
    let(:report) do
      PayrollPaymentAttestation.create!(time_entry: entry, user: employee, recorded_by: actor,
        source_user_uuid: employee.payroll_integration_uuid, source_time_entry_version: entry.lock_version,
        work_date: entry.work_date, hours: entry.hours, attested_at: 1.year.ago,
        reason: "Historical owner statement whose original weekly source revisions are missing")
    end

    it "keeps the report held rather than manufacturing an original source classification" do
      expect(context.fetch(:available)).to be(false)
      expect(context.fetch(:reason)).to include("Revision history")
      resolve(regular_hours: "8.0", overtime_hours: "0.0", expected_weekly_context_fingerprint: "0" * 64)
      expect(response).to have_http_status(:unprocessable_entity)
      expect(report.reload.status).to eq("pending_evidence")
      expect(PayrollManualAllocation.count).to eq(0)
    end
  end
end
