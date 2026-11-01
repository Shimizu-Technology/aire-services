# frozen_string_literal: true

require "rails_helper"

RSpec.describe Payroll::ReleasePaidHistory, type: :request do
  include ActiveSupport::Testing::TimeHelpers

  let(:admin) { create(:user, :admin) }
  let(:employee) { create(:user, :employee) }
  let(:category) { create(:time_category) }
  let(:plan) do
    dates = %w[2026-09-15T01:13:32Z 2026-09-22T23:09:33Z 2026-10-13T23:44:19Z 2026-10-27T00:22:02Z]
    { "periods" => described_class::PERIODS.zip(dates).map do |(start_date, end_date, id), time|
        { "start_date" => start_date, "end_date" => end_date, "external_pay_period_id" => id, "cutoff_at" => time, "processed_at" => time }
      end,
      "adjustment_entry_ids" => { "83" => [ @adjustments.first.id ], "85" => [ @adjustments.last.id ] },
      "adjustment_notes" => { "83" => "Reviewed exact source/check evidence for adjustment 83", "85" => "Reviewed exact source/check evidence for adjustment 85" } }
  end

  def entry(date, updated_at: nil)
    day = Date.iso8601(date)
    start = Time.find_zone!("Pacific/Guam").local(day.year, day.month, day.day, 8)
    source = create(:time_entry, user: employee, time_category: category, work_date: day,
      start_time: start, end_time: start + 8.hours, status: "completed", entry_method: "clock", clock_source: "mobile",
      approval_status: "approved", approved_at: start + 9.hours, overtime_status: "none",
      created_at: start, updated_at: updated_at || start + 9.hours)
    source.update_columns(created_at: start, updated_at: updated_at || start + 9.hours)
    source
  end

  def runner
    described_class.new(plan: plan, actor: admin)
  end

  def workspace(period)
    previous = ENV["PAYROLL_SHARED_SECRET"]
    ENV["PAYROLL_SHARED_SECRET"] = "release-history-workspace-secret"
    grant = PayrollIntegrationGrant.issue!(user: admin, capabilities: %w[settlement_case_management])
    get "/api/v1/payroll/cockpit/settlement_cases", params: { external_pay_period_id: period.external_pay_period_id },
      headers: { "X-Payroll-Shared-Secret" => ENV.fetch("PAYROLL_SHARED_SECRET"), "X-Aire-Delegation-Token" => grant.issued_token }
    expect(response).to have_http_status(:ok), response.body
    response.parsed_body.fetch("settlement_cases")
  ensure
    ENV["PAYROLL_SHARED_SECRET"] = previous
  end

  def apply_history
    preview = runner.call
    runner.call(apply: true, expected_digest: preview.fetch(:preview_digest))
  end

  def calendar(start_date: "2026-10-16", end_date: "2026-10-31", lock_mode: "scheduled")
    previous_payday = lock_mode == "manual" ? Date.new(2026, 10, 15) : Date.new(2026, 10, 31)
    pay_date = lock_mode == "manual" ? Date.new(2026, 10, 31) : Date.new(2026, 11, 15)
    cutoff_date = previous_payday + 7
    cutoff = Time.find_zone!("Pacific/Guam").local(cutoff_date.year, cutoff_date.month, cutoff_date.day, 17)
    create(:payroll_calendar_period, start_date: Date.iso8601(start_date), end_date: Date.iso8601(end_date),
      pay_date: pay_date, cutoff_at: cutoff, next_finalization_attempt_at: cutoff,
      schema_version: "2.0", cutoff_rule: "after_previous_regular_payday", cutoff_days: 7,
      previous_regular_pay_date: previous_payday,
      lock_mode: lock_mode, cutoff_enforcement_starts_on: Date.new(2026, 10, 16))
  end

  before do |example|
    stub_const("#{described_class}::ANCHOR_ENTRY_COUNT", 1) unless example.metadata[:production_anchor]
    @anchor_entry = entry("2026-08-10")
    if example.metadata[:production_anchor]
      attrs = @anchor_entry.attributes.except("id").merge("hours" => 0.1)
      TimeEntry.insert_all!(Array.new(133) { attrs.dup })
    end
    anchor = Payroll::BatchFinalizer.new(start_date: "2026-08-01", end_date: "2026-08-15", actor: admin,
      manual_processing: true, cutoff_at: "2026-08-31T03:06:00Z", processed_at: "2026-08-31T03:06:00Z",
      external_pay_period_id: "61", processing_note: "Original paid August snapshot").call
    anchor.payroll_batch_processing_events.create!(event_id: "original-integrated", status: "committed",
      occurred_at: anchor.cutoff_at, external_system: "cornerstone_payroll", external_pay_period_id: "61")
    anchor.payroll_batch_entries.each do |row|
      anchor.payroll_entry_processing_events.create!(event_id: "original-entry-#{row.source_time_entry_id}", status: "committed", occurred_at: anchor.cutoff_at,
        external_system: "cornerstone_payroll", external_pay_period_id: "61", source_time_entry_id: row.source_time_entry_id)
    end
    @old = entry("2026-07-10", updated_at: Time.iso8601("2026-09-05T00:00:00Z"))
    @paid = %w[2026-08-20 2026-09-02 2026-09-20 2026-10-05].map { |date| entry(date) }
    @edited = entry("2026-09-04", updated_at: Time.iso8601("2026-10-10T00:00:00Z"))
    @adjustments = %w[2026-09-07 2026-09-10].map { |date| entry(date) }
    @current = entry("2026-10-20")
    PayrollLockRollout.configure!(starts_on: "2026-10-16", actor: "Release operator", reason: "Approved October release boundary")
    allow(ConnectedPayrollMode).to receive(:enabled?).and_return(false)
  end

  it "previews without writes, records only the four ranges, holds old/edited/adjustment hours, and retries idempotently" do
    expect { runner.call }.not_to change { [ PayrollBatch.count, AuditLog.count, PayrollPaymentAttestation.count ] }
    expect(runner.call.fetch(:hold_entry_ids)).to match_array([ @old.id, @edited.id, *@adjustments.map(&:id) ])
    aggregate_plan = plan.deep_dup
    aggregate_plan["adjustment_entry_ids"] = { "83" => @adjustments.map(&:id), "85" => [] }
    aggregate_plan["adjustment_notes"]["85"] = "Reviewed adjustment 85: accounting-only item with no additional source-hour coverage"
    expect(described_class.new(plan: aggregate_plan, actor: admin).call.fetch(:hold_entry_ids))
      .to match_array([ @old.id, @edited.id, *@adjustments.map(&:id) ])
    preview = runner.call
    expect(preview[:status]).to eq("preview"), preview.inspect
    expect(apply_history).to include(status: "applied", held_count: 4, batch_checksums: preview.fetch(:batch_checksums))
    expect(PayrollBatch.count).to eq(5)
    @paid.each do |source|
      rows = PayrollBatchEntry.where(source_time_entry_id: source.id)
      expect(rows.sum(:total_hours)).to eq(8)
      expect(rows.pluck(:source_kind)).to eq([ "current" ])
    end
    expect(PayrollBatchEntry.where(source_time_entry_id: [ @old.id, @edited.id, *@adjustments.map(&:id) ])).to be_empty
    expect { expect(runner.call(apply: true)).to include(status: "already_applied") }
      .not_to change { [ PayrollBatch.count, AuditLog.count, PayrollPaymentAttestation.count ] }
    expect(PayrollOutboxEvent.count).to eq(0)
  end

  it "fails closed for a changed preview, unexpected inventory, active connection and published calendars" do
    service = runner
    preview = service.call
    @paid.first.update!(description: "A source edit after preview")
    expect { service.call(apply: true, expected_digest: preview.fetch(:preview_digest)) }.to raise_error(described_class::Error, /State changed/)
    expect(PayrollBatch.count).to eq(1)
    expect(PayrollPaymentAttestation.count).to eq(0)
    allow(ConnectedPayrollMode).to receive(:enabled?).and_return(true)
    expect { runner.call }.to raise_error(described_class::Error, /paused/)
    allow(ConnectedPayrollMode).to receive(:enabled?).and_return(false)
    calendar
    expect { runner.call }.to raise_error(described_class::Error, /Calendar inventory/)
  end

  it "rolls back holds, batches, processing events and audit evidence if a later period fails" do
    preview = runner.call
    before_counts = [ PayrollBatch.count, PayrollBatchEntry.count, PayrollBatchProcessingEvent.count, AuditLog.count ]
    allow(Payroll::BatchFinalizer).to receive(:new).and_wrap_original do |original, **options|
      finalizer = original.call(**options)
      if options[:external_pay_period_id] == "86"
        allow(finalizer).to receive(:call).and_raise("simulated failure after two historical batches")
      end
      finalizer
    end
    expect { runner.call(apply: true, expected_digest: preview.fetch(:preview_digest)) }
      .to raise_error("simulated failure after two historical batches")
    expect([ PayrollBatch.count, PayrollBatchEntry.count, PayrollBatchProcessingEvent.count, AuditLog.count ]).to eq(before_counts)
    expect(PayrollPaymentAttestation.count).to eq(0)
    expect(PayrollPaymentAttestationEvent.count).to eq(0)
    expect(AuditLog.where(action: described_class::ACTION)).to be_empty
    expect(PayrollBatchEntry.where(source_time_entry_id: @paid.map(&:id))).to be_empty
  end

  it "blocks arbitrary ranges but calendar paths quarantine old hours without blocking other employees" do
    post "/api/v1/admin/payroll_batches/preview", params: { start_date: "2026-10-01", end_date: "2026-10-15" },
      headers: { "Authorization" => "Bearer test_token_#{admin.id}" }
    expect(response).to have_http_status(:ok)
    expect(response.parsed_body).to include("can_finalize" => false, "finalization_blocked_reason" => /Record already processed/)
    expect do
      Payroll::BatchFinalizer.new(start_date: "2026-10-01", end_date: "2026-10-15", actor: admin).call
    end.to raise_error(Payroll::BatchFinalizer::FinalizationError, /Record already processed/)
    allow(ConnectedPayrollMode).to receive(:enabled?).and_return(true)
    manual = calendar(start_date: "2026-10-01", end_date: "2026-10-15", lock_mode: "manual")
    expect(Payroll::ManualCalendarFinalizer.new(period_id: manual.id, actor: admin, reason: "Manual lock test").call)
      .to include(status: "finalized")
    expect(manual.reload.payroll_batch.payroll_batch_entries).to be_empty
    scheduled = calendar
    travel_to(Time.iso8601("2026-11-07T07:01:00Z")) do
      expect(Payroll::ScheduledCutoffFinalizer.new(period_id: scheduled.id).call).to include(status: "finalized")
    end
    expect(scheduled.reload.payroll_batch.payroll_batch_entries.pluck(:source_time_entry_id)).to eq([ @current.id ])
    expect(PayrollSettlementCase.active.where(source_time_entry_id: @paid.map(&:id)).count).to eq(4)
  end

  it "keeps October scheduled hours clean and includes only an explicitly routed post-payment delta" do
    apply_history
    # A real later edit to a recorded eight-hour baseline needs a correction,
    # not another payment of its new ten-hour total.
    source = @paid.last
    source.update!(end_time: source.end_time + 2.hours, hours: 10)
    period = calendar
    Payroll::SettlementCaseCoordinator.sync_finalized_periods!
    settlement_case = PayrollSettlementCase.find_by!(source_time_entry_id: source.id)
    expect(settlement_case).to have_attributes(status: "open", destination_kind: "unassigned")
    Payroll::SettlementCaseCoordinator.prepare_for_period!(period)
    expect(settlement_case.reload.destination_kind).to eq("unassigned")
    preview = Payroll::BatchBuilder.new(start_date: period.start_date, end_date: period.end_date,
      cutoff_at: period.cutoff_at, calendar_period: period).call
    expect(preview.fetch(:rows).map { |row| row[:source_time_entry_id] }).to eq([ @current.id ])
    Payroll::SettlementCaseRouter.new(settlement_case: settlement_case, destination_kind: "regular",
      target_external_pay_period_id: period.external_pay_period_id, action_due_on: "2026-11-15", assigned_to_id: nil,
      reason: "Reviewed the paid baseline and authorized the two-hour correction", actor: admin).call
    allow(ConnectedPayrollMode).to receive(:enabled?).and_return(true)
    travel_to(Time.iso8601("2026-11-07T07:01:00Z")) do
      expect(Payroll::ScheduledCutoffFinalizer.new(period_id: period.id).call).to include(status: "finalized")
    end
    batch = period.reload.payroll_batch
    expect(batch.payroll_batch_entries.pluck(:source_time_entry_id, :source_kind, :total_hours))
      .to contain_exactly([ @current.id, "current", 8 ], [ source.id, "correction", 2 ])
    expect(batch.summary.fetch("total_hours")).to eq(10)
    expect(settlement_case.reload.status).to eq("in_payroll")
    expect(PayrollPaymentAttestation.pending_evidence.count).to eq(4)
  end

  it "rejects a changed live snapshot and out-of-order manual backfill instead of silently absorbing it" do
    period = plan.fetch("periods")[1]
    expect do
      Payroll::BatchFinalizer.new(**period.symbolize_keys, actor: admin, manual_processing: true,
        processing_note: "Reviewed historical payroll baseline").call
    end.to raise_error(Payroll::BatchFinalizer::FinalizationError, /changed after the paid snapshot/)
    apply_history
    expect do
      Payroll::BatchFinalizer.new(start_date: "2026-07-01", end_date: "2026-07-15", actor: admin, manual_processing: true,
        cutoff_at: "2026-08-20T00:00:00Z", processed_at: "2026-08-20T00:00:00Z",
        external_pay_period_id: "old", processing_note: "Historical earlier payroll").call
    end.to raise_error(Payroll::BatchFinalizer::OutOfOrderFinalizationError, /order/)
  end
  it "rehearses the real 134-entry anchor without stubbing the inventory constant", :production_anchor do
    expect(described_class::ANCHOR_ENTRY_COUNT).to eq(134)
    expect(PayrollBatch.first.payroll_batch_entries.count).to eq(134)
    expect(runner.call[:status]).to eq("preview")
    expect(apply_history[:status]).to eq("applied")
  end

  it "preserves pending NULL and denied legacy entries; a November 6 approval opens a case and cutoff succeeds" do
    pending = entry("2026-08-21")
    pending.update_columns(approval_status: nil, approved_at: nil)
    denied = entry("2026-07-12")
    denied.update_columns(approval_status: "denied", approved_at: nil)
    expect(runner.call.fetch(:hold_entry_ids)).not_to include(pending.id, denied.id)
    expect(apply_history[:status]).to eq("applied")
    expect(PayrollBatchEntry.where(source_time_entry_id: pending.id)).to be_empty
    travel_to(Time.iso8601("2026-11-06T00:00:00Z")) do
      pending.update!(approval_status: "approved", approved_at: Time.current)
    end
    target = calendar
    allow(ConnectedPayrollMode).to receive(:enabled?).and_return(true)
    travel_to(target.cutoff_at + 1.minute) do
      expect(Payroll::ScheduledCutoffFinalizer.new(period_id: target.id).call).to include(status: "finalized")
    end
    expect(target.reload.payroll_batch.payroll_batch_entries.pluck(:source_time_entry_id)).to eq([ @current.id ])
    review = PayrollSettlementCase.active.find_by!(source_time_entry_id: pending.id)
    expect(workspace(target).map { |item| item.fetch("id") }).to include(review.public_id)
    expect(review).to have_attributes(destination_kind: "unassigned", origin_reason: "legacy_history_review")
    expect(review.origin_payroll_batch.payroll_batch_processing_events.sole.external_pay_period_id).to eq("67")
    expect(review.payroll_settlement_case_events.sole.metadata).to include("requires_explicit_routing" => true)
  end

  it "captures a retracted release hold before cutoff and permits re-holding without changing history" do
    apply_history
    recorder = Payroll::PaymentAttestationRecorder.new(actor: admin)
    old = PayrollPaymentAttestation.pending_evidence.find_by!(time_entry_id: @old.id)
    recorder.retract!(attestation: old, reason: "Rechecking July payment evidence against the owner's source register")
    review = PayrollSettlementCase.active.find_by!(source_time_entry_id: @old.id)
    target = calendar
    allow(ConnectedPayrollMode).to receive(:enabled?).and_return(true)
    travel_to(target.cutoff_at + 1.minute) do
      expect(Payroll::ScheduledCutoffFinalizer.new(period_id: target.id).call).to include(status: "finalized")
    end
    expect(target.reload.payroll_batch.payroll_batch_entries.pluck(:source_time_entry_id)).to eq([ @current.id ])
    replacement = recorder.attest!(entry: @old.reload, source_user_uuid: employee.payroll_integration_uuid,
      reason: "Owner reconfirmed July payment; retain the hold until exact check allocation")
    expect(replacement.id).not_to eq(old.id)
    expect(old.reload.status).to eq("retracted")
    expect(old.payroll_payment_attestation_events.pluck(:event_type)).to eq(%w[attested retracted])
    expect(review.reload.status).to eq("superseded")
  end

  it "never records an owed September source as paid and admits it only after explicit routing" do
    owed = entry("2026-09-15", updated_at: Time.iso8601("2026-10-07T00:00:00Z"))
    owed.update_columns(hours: 4.25, created_at: Time.iso8601("2026-09-23T03:14:22Z"))
    plan["owed_entry_ids"] = [ owed.id ]
    expect(runner.call.fetch(:hold_entry_ids)).not_to include(owed.id)
    expect(apply_history[:status]).to eq("applied")
    expect(PayrollBatchEntry.where(source_time_entry_id: owed.id)).to be_empty
    expect(PayrollPaymentAttestation.where(time_entry_id: owed.id)).to be_empty
    review = PayrollSettlementCase.active.find_by!(source_time_entry_id: owed.id)
    target = calendar
    Payroll::SettlementCaseCoordinator.prepare_for_period!(target)
    expect(review.reload.destination_kind).to eq("unassigned")
    expect(workspace(target).map { |item| item.fetch("id") }).to include(review.public_id)
    Payroll::SettlementCaseRouter.new(settlement_case: review, destination_kind: "regular",
      target_external_pay_period_id: target.external_pay_period_id, action_due_on: "2026-11-15", assigned_to_id: nil,
      reason: "Entry was created after calculation and never paid; authorize exactly 4.25 hours", actor: admin).call
    allow(ConnectedPayrollMode).to receive(:enabled?).and_return(true)
    travel_to(target.cutoff_at + 1.minute) do
      expect(Payroll::ScheduledCutoffFinalizer.new(period_id: target.id).call).to include(status: "finalized")
    end
    expect(target.reload.payroll_batch.payroll_batch_entries.where(source_time_entry_id: owed.id).sum(:total_hours)).to eq(4.25)
  end

  it "reports missing categories in the full rehearsal and supports an audited acknowledgement without source edits" do
    @paid.first.update_columns(time_category_id: nil)
    failed = runner.call
    expect(failed).to include(status: "preview_failed", error: /missing work categories/)
    expect(PayrollBatch.count).to eq(1)
    plan["acknowledge_missing_categories"] = true
    plan["missing_category_note"] = "Source categories were absent historically; accounting reviewed the paid totals and will reconcile category mappings separately."
    preview = runner.call
    expect(preview[:status]).to eq("preview"), preview.inspect
    expect(preview[:hold_entry_ids]).not_to include(@paid.first.id)
    expect(runner.call(apply: true, expected_digest: preview[:preview_digest])[:batch_checksums]).to eq(preview[:batch_checksums])
  end

  it "previews a weekly chronology hold as a failure and rolls every simulated write back" do
    # Unplaced break chronology holds the entire affected week, leaving no paid baseline.
    split = entry("2026-08-31")
    start = Time.find_zone!("Pacific/Guam").local(2026, 8, 31, 22)
    split.update_columns(start_time: start, end_time: start + 8.hours, break_minutes: 30, hours: 7.5)
    before = [ PayrollBatch.count, PayrollPaymentAttestation.count, AuditLog.count ]
    # The split itself is held; its unresolved overtime week must also be detected by rehearsal.
    sibling = entry("2026-08-30")
    sibling.update_columns(updated_at: sibling.start_time + 9.hours)
    preview = runner.call
    expect(preview).to include(status: "preview_failed", error: /remain uncovered/)
    expect([ PayrollBatch.count, PayrollPaymentAttestation.count, AuditLog.count ]).to eq(before)
  end

  it "lists and holds split manual-period source entries, including existing anchor-boundary work" do
    split = entry("2026-08-31")
    start = Time.find_zone!("Pacific/Guam").local(2026, 8, 31, 22)
    split.update_columns(start_time: start, end_time: start + 8.hours, hours: 8)
    preview = runner.call
    expect(preview[:split_entry_ids]).to include(split.id)
    expect(preview[:hold_entry_ids]).to include(split.id)
    expect(preview[:status]).to eq("preview"), preview.inspect
    expect(apply_history[:status]).to eq("applied")
    expect(PayrollBatchEntry.where(source_time_entry_id: split.id)).to be_empty
  end

  it "ignores volatile user updates in the reviewed digest" do
    digest = runner.call.fetch(:preview_digest)
    employee.update_columns(updated_at: Time.current + 1.minute)
    expect(runner.call.fetch(:preview_digest)).to eq(digest)
    employee.update_columns(first_name: "New source identity label")
    expect(runner.call.fetch(:preview_digest)).not_to eq(digest)
  end

  it "does not re-select a represented August 15 overnight entry in the following range" do
    start = Time.find_zone!("Pacific/Guam").local(2026, 8, 15, 22)
    @anchor_entry.update_columns(work_date: Date.new(2026, 8, 15), start_time: start, end_time: start + 8.hours)
    preview = runner.call
    expect(preview[:split_entry_ids]).to include(@anchor_entry.id)
    expect(preview[:hold_entry_ids]).not_to include(@anchor_entry.id)
    expect(preview[:status]).to eq("preview"), preview.inspect
    expect(apply_history[:status]).to eq("applied")
    expect(PayrollBatchEntry.where(source_time_entry_id: @anchor_entry.id).count).to eq(1)
  end

  it "re-holds an existing retracted source during the full release rehearsal and apply" do
    recorder = Payroll::PaymentAttestationRecorder.new(actor: admin)
    original = recorder.attest!(entry: @old, source_user_uuid: employee.payroll_integration_uuid,
      reason: "Owner reported July hours paid; original paper check evidence remains pending")
    recorder.retract!(attestation: original, reason: "Review the source-to-check allocation once more before holding")
    preview = runner.call
    expect(preview[:status]).to eq("preview"), preview.inspect
    expect(PayrollPaymentAttestation.count).to eq(1)
    expect(apply_history[:status]).to eq("applied")
    expect(PayrollPaymentAttestation.pending_evidence.where(time_entry_id: @old.id).count).to eq(1)
    expect(original.reload.status).to eq("retracted")
  end

  it "detects multiple substantive manual source edits while ignoring timestamp-only sibling touches" do
    apply_history
    source = @paid.last
    source.update_columns(updated_at: Time.current)
    Payroll::ManualBatchCorrectionReview.call
    expect(PayrollSettlementCase.where(source_time_entry_id: source.id)).to be_empty
    source.update!(end_time: source.end_time + 1.hour, hours: 9)
    Payroll::ManualBatchCorrectionReview.call
    first = PayrollSettlementCase.active.find_by!(source_time_entry_id: source.id)
    Payroll::SettlementCaseRouter.new(settlement_case: first, destination_kind: "not_payable",
      target_external_pay_period_id: nil, action_due_on: nil, assigned_to_id: nil,
      reason: "Reviewed first edit as not payable", actor: admin).call
    source.update!(end_time: source.end_time + 1.hour, hours: 10)
    2.times { Payroll::ManualBatchCorrectionReview.call }
    second = PayrollSettlementCase.active.find_by!(source_time_entry_id: source.id)
    expect(second.id).not_to eq(first.id)
    expect(second.source_time_entry_version).to eq(source.reload.lock_version)
    expect(PayrollSettlementCase.where(source_time_entry_id: source.id).count).to eq(2)
  end

  it "logs and surfaces manual correction discovery failure instead of reporting a clean sync" do
    allow(Payroll::ManualBatchCorrectionReview).to receive(:call).and_raise("synthetic correction discovery failure")
    expect(Rails.logger).to receive(:error).with(/Manual batch correction review failed/)
    expect { Payroll::SettlementCaseCoordinator.sync_finalized_periods! }.to raise_error("synthetic correction discovery failure")
  end

  it "rehearses the audited 966 approved, 20 pending, 10 denied and 55-category-gap inventory", :production_anchor do
    attrs = @paid.first.attributes.except("id").merge("hours" => 0.01)
    TimeEntry.insert_all!(Array.new(957) { |index| attrs.merge("time_category_id" => index < 55 ? nil : category.id) })
    pending_attrs = attrs.merge("approval_status" => nil, "approved_at" => nil)
    july = Date.new(2026, 7, 10)
    TimeEntry.insert_all!(Array.new(18) { pending_attrs.merge("work_date" => july) } +
      [ pending_attrs.merge("work_date" => Date.new(2026, 8, 20), "hours" => 6.38),
        pending_attrs.merge("work_date" => Date.new(2026, 8, 21), "hours" => 4.38) ])
    TimeEntry.insert_all!(Array.new(10) { attrs.merge("approval_status" => "denied") })
    owed = entry("2026-09-15", updated_at: Time.iso8601("2026-10-07T00:00:00Z"))
    owed.update_columns(hours: 4.25, created_at: Time.iso8601("2026-09-23T03:14:22Z"))
    plan["owed_entry_ids"] = [ owed.id ]
    plan["adjustment_entry_ids"] = { "83" => [], "85" => [] }
    plan["adjustment_notes"] = { "83" => "Voided duplicate: no hours paid or source entries covered.",
      "85" => "Francisco's paid 80.30 regular + 14.00 OT hours have no September 1–15 AIRE entries." }
    plan["acknowledge_missing_categories"] = true
    plan["missing_category_note"] = "Reviewed 55 historical category gaps; preserve the original source and paid totals."
    inventory = TimeEntry.where("work_date < ?", Date.new(2026, 10, 16))
      .where.not(id: PayrollBatchEntry.select(:source_time_entry_id))
    expect(inventory.where(approval_status: "approved").count).to eq(966)
    expect(inventory.where(approval_status: nil).count).to eq(20)
    expect(inventory.where(approval_status: "denied").count).to eq(10)
    expect(inventory.where(time_category_id: nil).count).to eq(55)
    preview = runner.call
    expect(preview[:status]).to eq("preview"), preview.inspect
    expect(preview[:split_entry_ids]).to be_empty
    expect(preview[:hold_entry_ids]).not_to include(owed.id)
    expect(runner.call(apply: true, expected_digest: preview[:preview_digest])[:batch_checksums]).to eq(preview[:batch_checksums])
    expect(PayrollPaymentAttestation.where(time_entry_id: inventory.where(approval_status: nil).select(:id))).to be_empty
  end
end
