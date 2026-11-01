# frozen_string_literal: true

require "rails_helper"

RSpec.describe Payroll::ReleasePaidHistory, type: :request do
  include ActiveSupport::Testing::TimeHelpers

  let(:admin) { create(:user, :admin) }
  let(:employee) { create(:user, :employee) }
  let(:category) { create(:time_category) }
  let(:plan) do
    dates = %w[2026-09-14T03:00:00Z 2026-09-29T03:00:00Z 2026-10-14T03:00:00Z 2026-10-27T03:00:00Z]
    { "periods" => described_class::PERIODS.zip(dates).map do |(start_date, end_date, id), time|
        { "start_date" => start_date, "end_date" => end_date, "external_pay_period_id" => id, "cutoff_at" => time, "processed_at" => time }
      end,
      "adjustment_entry_ids" => { "83" => [ @adjustments.first.id ], "85" => [ @adjustments.last.id ] } }
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

  before do
    stub_const("#{described_class}::ANCHOR_ENTRY_COUNT", 1)
    @anchor_entry = entry("2026-08-10")
    anchor = Payroll::BatchFinalizer.new(start_date: "2026-08-01", end_date: "2026-08-15", actor: admin,
      manual_processing: true, cutoff_at: "2026-08-31T03:06:00Z", processed_at: "2026-08-31T03:06:00Z",
      external_pay_period_id: "61", processing_note: "Original paid August snapshot").call
    anchor.payroll_batch_processing_events.create!(event_id: "original-integrated", status: "committed",
      occurred_at: anchor.cutoff_at, external_system: "cornerstone_payroll", external_pay_period_id: "61")
    anchor.payroll_entry_processing_events.create!(event_id: "original-entry", status: "committed", occurred_at: anchor.cutoff_at,
      external_system: "cornerstone_payroll", external_pay_period_id: "61", source_time_entry_id: @anchor_entry.id)
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
    expect(apply_history).to include(status: "applied", held_count: 4)
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
    preview = runner.call
    @paid.first.update!(description: "A source edit after preview")
    expect { runner.call(apply: true, expected_digest: preview.fetch(:preview_digest)) }.to raise_error(described_class::Error, /State changed/)
    expect(PayrollBatch.count).to eq(1)
    expect(PayrollPaymentAttestation.count).to eq(0)
    allow(ConnectedPayrollMode).to receive(:enabled?).and_return(true)
    expect { runner.call }.to raise_error(described_class::Error, /paused/)
    allow(ConnectedPayrollMode).to receive(:enabled?).and_return(false)
    calendar
    expect { runner.call }.to raise_error(described_class::Error, /Calendar inventory/)
  end

  it "blocks arbitrary, Payroll manual Lock and scheduled cutoffs before reconciliation, with an actionable message" do
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
      .to include(status: "failed", error: /Historical manually paid hours/)
    scheduled = calendar
    travel_to(Time.iso8601("2026-11-07T07:01:00Z")) do
      expect(Payroll::ScheduledCutoffFinalizer.new(period_id: scheduled.id).call)
        .to include(status: "failed", error: /Record already processed/)
    end
    expect(PayrollBatch.count).to eq(1)
    expect(PayrollOutboxEvent.count).to eq(0)
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
end
