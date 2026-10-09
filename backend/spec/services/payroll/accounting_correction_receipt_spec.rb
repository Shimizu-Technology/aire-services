# frozen_string_literal: true

require "rails_helper"

RSpec.describe Payroll::AccountingCorrectionReceipt do
  let(:entry) { create(:time_entry, work_date: Date.new(2026, 9, 5)) }
  let(:batch) { create(:payroll_batch, start_date: Date.new(2026, 10, 1), end_date: Date.new(2026, 10, 15), cutoff_at: Time.zone.local(2026, 10, 18, 17)) }
  let(:metadata) do
    { "accounting_only" => true, "correction_disposition_id" => "9", "original_pay_period_id" => "10", "original_payroll_item_id" => "11",
      "corrective_pay_period_id" => "44", "corrective_payroll_item_id" => "55" }
  end
  let(:row) do
    batch.payroll_batch_entries.create!(source_time_entry_id: entry.id, source_user_id: entry.user_id, source_user_uuid: entry.user.payroll_integration_uuid,
      source_category_id: entry.time_category_id, work_date: entry.work_date, week_start: entry.work_date.beginning_of_week(:sunday), source_kind: "correction",
      line_key: "negative-exact", total_hours: -1, regular_hours: -1, overtime_hours: 0, snapshot: { "version" => entry.lock_version })
  end
  let(:event) do
    PayrollEntryProcessingEvent.create!(payroll_batch: batch, event_id: SecureRandom.uuid, source_time_entry_id: entry.id,
      source_user_uuid: row.source_user_uuid, contract_version: "2.0", source_line_key: row.line_key, source_kind: "correction",
      total_hours: -1, regular_hours: -1, overtime_hours: 0, status: "committed", external_system: "cornerstone_payroll",
      external_pay_period_id: "44", external_payroll_item_id: "55", occurred_at: Time.current, metadata: metadata)
  end

  it "recognizes only exact committed noncash metadata and actual corrective destination IDs" do
    expect(described_class.context(row: row, event: event)).to eq(metadata)
  end

  it "keeps negative accounting quantities separate from cash outstanding and never calls a mixed batch paid" do
    positive = batch.payroll_batch_entries.create!(source_time_entry_id: entry.id, source_user_id: entry.user_id, source_user_uuid: row.source_user_uuid,
      work_date: entry.work_date, week_start: row.week_start, source_kind: "current", line_key: "positive", total_hours: 4, regular_hours: 4, overtime_hours: 0)
    paid = PayrollEntryProcessingEvent.create!(payroll_batch: batch, event_id: SecureRandom.uuid, source_time_entry_id: entry.id,
      source_user_uuid: row.source_user_uuid, contract_version: "2.0", source_line_key: positive.line_key, source_kind: "current",
      total_hours: 4, regular_hours: 4, overtime_hours: 0, status: "payment_issued", external_system: "cornerstone_payroll",
      external_pay_period_id: "10", external_payroll_item_id: "11", payment_method: "paper_check", payment_reference: "ORIGINAL", occurred_at: Time.current)
    before = paid.attributes.deep_dup
    summary = Payroll::EntryProcessingSummary.new(rows: [ positive, row ], events: [ paid, event ]).call
    expect(summary).to include(status: "partially_paid", total_hours: 3.0, paid_hours: 4.0, outstanding_hours: 0.0,
      accounting_only: false, accounting_correction_hours: -1.0, accounting_correction_line_count: 1)
    expect(summary[:lines].find { |line| line[:source_line_key] == row.line_key }).to include(accounting_only: true, label: described_class::LABEL)
    expect(paid.reload.attributes).to eq(before)
  end

  it "preserves the paid origin settlement and labels the later accounting receipt without payment or recovery" do
    original = create(:payroll_batch)
    original_row = original.payroll_batch_entries.create!(source_time_entry_id: entry.id, source_user_id: entry.user_id,
      source_user_uuid: row.source_user_uuid, work_date: entry.work_date, week_start: row.week_start, source_kind: "current", line_key: "origin",
      total_hours: 4, regular_hours: 4, overtime_hours: 0)
    original_event = PayrollEntryProcessingEvent.create!(payroll_batch: original, event_id: SecureRandom.uuid, source_time_entry_id: entry.id,
      source_user_uuid: row.source_user_uuid, contract_version: "2.0", source_line_key: original_row.line_key, source_kind: "current",
      total_hours: 4, regular_hours: 4, overtime_hours: 0, status: "payment_issued", external_system: "cornerstone_payroll", payment_reference: "ORIGINAL",
      occurred_at: Time.current - 1.minute)
    event
    lifecycle = Payroll::EntryLifecycleResolver.new(entries: [ entry ]).call.fetch(entry.id)
    expect(lifecycle).to include(status: "committed", accounting_only: true, label: described_class::LABEL)
    expect(lifecycle[:settlements]).to include(include(status: "payment_issued", paid_hours: 4.0, payment_reference: "ORIGINAL"))
    expect(original_event.reload.status).to eq("payment_issued")
    expect(lifecycle[:payment_reference]).to be_nil
    expect(Payroll::EntryLifecycleResolver.summary([ lifecycle ])).to eq("accounting_correction_committed" => 1)
  end

  { status: "payment_voided", source_line_key: "other", source_user_uuid: SecureRandom.uuid, source_kind: "current", total_hours: 1,
    regular_hours: -2, contract_version: nil, external_pay_period_id: "99", external_payroll_item_id: "99", payment_reference: "FAKE", payment_method: "paper_check" }.each do |key, value|
    it "fails closed for changed #{key}" do
      changed = event.dup
      changed.public_send("#{key}=", value)
      expect(described_class.context(row: row, event: changed)).to be_nil
    end
  end

  [ { "accounting_only" => "true" }, { "correction_disposition_id" => "0" }, { "original_payroll_item_id" => 11 },
    { "corrective_pay_period_id" => "99" }, { "original_pay_period_id" => "44" }, { "payment_effective_on" => "2026-09-06" } ].each do |bad|
    it "does not infer accounting resolution from malformed metadata #{bad.keys.first}" do
      changed = event.dup
      changed.metadata = metadata.merge(bad)
      expect(described_class.context(row: row, event: changed)).to be_nil
    end
  end

  it "does not keep an earlier accounting resolution after a later effective noncommitted receipt" do
    later = event.dup
    later.event_id = SecureRandom.uuid
    later.occurred_at = event.occurred_at + 1.second
    later.status = "payment_failed"
    later.save!
    summary = Payroll::EntryProcessingSummary.new(rows: [ row ], events: [ event, later ]).call
    expect(summary[:accounting_only]).to be_nil
    expect(summary[:status]).to eq("payment_failed")
    expect(summary[:lines].first[:accounting_only]).to be_nil
  end

  it "shows a case's accounting receipt without closing it as a cash settlement" do
    event
    settlement_case = create(:payroll_settlement_case, origin_reason: "changed_after_cutoff", source_time_entry_id: entry.id,
      source_time_entry_version: entry.lock_version, source_user_id: entry.user_id, source_user_uuid: row.source_user_uuid, original_work_date: entry.work_date,
      included_payroll_batch: batch, destination_kind: "supplemental", target_external_pay_period_id: "44", status: "in_payroll")
    before = settlement_case.attributes.deep_dup
    result = Payroll::SettlementCaseSerializer.new(settlement_case).as_json
    expect(result[:processing]).to include(status: "committed", accounting_only: true, label: described_class::LABEL)
    expect(result[:status]).to eq("in_payroll")
    expect(settlement_case.reload.attributes).to eq(before)
    expect(result[:processing][:payment_reference]).to be_nil
  end

  it "keeps a current owner payment-evidence hold ahead of accounting history" do
    event
    PayrollPaymentAttestation.create!(time_entry: entry, user: entry.user, recorded_by: entry.user,
      source_user_uuid: entry.user.payroll_integration_uuid, source_time_entry_version: entry.lock_version,
      work_date: entry.work_date, hours: entry.hours, reason: "Original payment evidence still needs review", attested_at: Time.current)
    lifecycle = Payroll::EntryLifecycleResolver.new(entries: [ entry ]).call.fetch(entry.id)
    expect(lifecycle[:status]).to eq("payment_attested_pending_evidence")
    expect(lifecycle[:accounting_only]).to be_nil
    expect(lifecycle[:label]).to eq("Payment reported; check evidence pending")
  end

  [ [], "legacy snapshot", 42, false, true ].each do |snapshot|
    it "retains case-event fallback for a non-object frozen snapshot #{snapshot.inspect}" do
      malformed = batch.payroll_batch_entries.create!(source_time_entry_id: entry.id, source_user_id: entry.user_id,
        source_user_uuid: entry.user.payroll_integration_uuid, source_category_id: entry.time_category_id,
        work_date: entry.work_date, week_start: entry.work_date.beginning_of_week(:sunday), source_kind: "correction",
        line_key: "legacy-negative", total_hours: -1, regular_hours: -1, overtime_hours: 0, snapshot: snapshot)
      settlement_case = create(:payroll_settlement_case, origin_reason: "changed_after_cutoff", source_time_entry_id: entry.id,
        source_time_entry_version: entry.lock_version, source_user_id: entry.user_id, source_user_uuid: entry.user.payroll_integration_uuid,
        original_work_date: entry.work_date, included_payroll_batch: batch, destination_kind: "supplemental",
        target_external_pay_period_id: "44", status: "in_payroll")
      fallback = settlement_case.payroll_settlement_case_events.create!(event_id: SecureRandom.uuid, event_type: "committed",
        to_status: "in_payroll", occurred_at: Time.current, metadata: { "external_pay_period_id" => "44", "external_payroll_item_id" => "55" })
      before = malformed.attributes.deep_dup
      serialized = Payroll::SettlementCaseSerializer.new(settlement_case).as_json
      expect(serialized[:processing]).to include(status: "committed", external_pay_period_id: "44", external_payroll_item_id: "55")
      expect(serialized[:processing]).not_to have_key(:accounting_only)
      expect(serialized[:events]).to include(include(event_type: fallback.event_type))
      expect(malformed.reload.attributes).to eq(before)
      expect(settlement_case.reload.status).to eq("in_payroll")
    end
  end
end
