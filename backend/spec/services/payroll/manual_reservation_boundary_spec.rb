# frozen_string_literal: true

require "rails_helper"
require_relative "../../support/payroll_clock_helpers"

RSpec.describe "Manual reservation review boundaries" do
  include PayrollClockHelpers

  let(:actor) { create(:user, :admin) }
  let(:employee) { create(:user, :employee) }
  let(:recorder) { Payroll::ManualAllocationRecorder.new(actor: actor) }
  let(:dates) { payroll_calendar_at(database_clock) }
  let(:entry) do
    create(:time_entry, user: employee, work_date: dates.fetch(:start_date) + 2.days,
      entry_method: "clock", status: "completed", approval_status: nil, overtime_status: "none")
  end

  def reserve(hours = 8)
    recorder.commit!(entry: entry, source_user_uuid: employee.payroll_integration_uuid,
      regular_hours: hours, overtime_hours: 0, external_pay_period_id: "manual-review",
      external_payroll_item_id: SecureRandom.uuid, pay_date: database_clock.to_date.iso8601,
      reason: "Independent synthetic review reservation")
  end

  def origin
    entry
    create(:payroll_calendar_period, **payroll_calendar_at(capture_payroll_cutoff))
  end

  def finalize(period)
    wait_for_database_cutoff(period.cutoff_at)
    result = Payroll::ScheduledCutoffFinalizer.new(period_id: period.id).call
    expect(result).to include(status: "finalized")
    period.reload.payroll_batch
  end

  def release(allocation)
    recorder.void!(allocation: allocation, occurred_at: database_clock.iso8601(6),
      reason: "Verified synthetic unissued wage release")
  end

  def issue(allocation, reference)
    recorder.issue!(allocation: allocation, payment_method: "paper_check", payment_reference: reference,
      payment_effective_on: database_clock.to_date.iso8601, occurred_at: database_clock.iso8601(6),
      reason: "Verified synthetic payment delivery")
  end

  def cancel(allocation, reference)
    recorder.cancel_payment!(allocation: allocation, payment_method: "paper_check", payment_reference: reference,
      payment_effective_on: database_clock.to_date.iso8601, occurred_at: database_clock.iso8601(6),
      reason: "Verified synthetic instrument stop", cancellation_evidence_reference: "stop-#{reference}")
  end

  def historical_period
    old = create(:payroll_calendar_period, **payroll_calendar_at(database_clock - 1.month))
    batch = PayrollBatch.create!(public_id: "REVIEW-#{SecureRandom.hex(5)}", start_date: old.start_date,
      end_date: old.end_date, cutoff_at: old.cutoff_at, finalized_at: old.cutoff_at,
      checksum: "a" * 64, payload: {}, summary: {}, issues: {})
    old.update!(status: "finalized", payroll_batch: batch, finalized_at: database_clock)
    old
  end

  def direct_allocation(**attributes)
    PayrollManualAllocation.create!({ time_entry: entry, user: employee, recorded_by: actor,
      source_user_uuid: employee.payroll_integration_uuid, source_time_entry_version: entry.lock_version,
      work_date: entry.work_date, pay_date: database_clock.to_date, regular_hours: 8, overtime_hours: 0,
      external_pay_period_id: "direct-import", external_payroll_item_id: SecureRandom.uuid,
      reason: "Synthetic direct import without events" }.merge(attributes))
  end

  it "F1 rolls back a claim whose DB-stamped insert crosses a future cutoff" do
    entry
    actor
    attributes = payroll_calendar_at(database_clock + 1.second)
    period = create(:payroll_calendar_period, **attributes)
    checked = 0
    recorded_at = nil
    allow(recorder).to receive(:reject_pending_cutoff_claim!).and_wrap_original do |method, *args|
      checked += 1
      if checked == 2
        recorded_at = PayrollManualAllocationRevision.order(:id).last!.recorded_at
        expect(recorded_at).to be > period.cutoff_at
      end
      method.call(*args)
    end
    allow(recorder).to receive(:weekly_split).and_wrap_original do |method, *args|
      wait_for_database_cutoff(period.cutoff_at)
      method.call(*args)
    end

    expect { reserve }.to raise_error(Payroll::ManualAllocationRecorder::ClaimConflictError, /cutoff.*reconcile/)
    expect(checked).to eq(2)
    expect(recorded_at).to be_present
    expect(PayrollManualAllocation.count).to eq(0)
    expect(PayrollManualAllocationRevision.count).to eq(0)
    expect(PayrollManualAllocationEvent.count).to eq(0)
    batch = finalize(period)
    expect(batch.payroll_batch_entries.where(source_time_entry_id: entry.id).sum(:total_hours)).to eq(8)
  end

  it "F1 preserves a partial reservation stamped before cutoff when the post-insert check runs after it" do
    entry
    actor
    period = create(:payroll_calendar_period, **payroll_calendar_at(database_clock + 1.second))
    checked = 0
    allow(recorder).to receive(:reject_pending_cutoff_claim!).and_wrap_original do |method, *args|
      checked += 1
      if checked == 2
        expect(args.last).to be < period.cutoff_at
        wait_for_database_cutoff(period.cutoff_at)
      end
      method.call(*args)
    end
    allocation = reserve(3)
    expect(checked).to eq(2)
    batch = finalize(period)
    expect(batch.summary.fetch("total_hours")).to eq(5)
    expect(allocation.total_hours + batch.payroll_batch_entries.sum(:total_hours)).to eq(8)
  end

  it "F2 releases a covered modern reservation despite an unrelated pre-migration frozen calendar" do
    old = historical_period
    allocation = reserve
    allocation.update_columns(created_at: old.cutoff_at - 1.day)
    modern = origin
    batch = finalize(modern)
    checksum = batch.checksum
    expect(batch.summary.fetch("total_hours")).to eq(0)

    expect { release(allocation) }.not_to raise_error
    expect(allocation.reload.status).to eq("voided")
    settlement = PayrollSettlementCase.find_by!(source_time_entry_id: entry.id)
    expect(settlement).to have_attributes(origin_payroll_batch: batch, status: "open", held_total_hours: 8)
    2.times { Payroll::SettlementCaseCoordinator.sync_finalized_periods! }
    expect(PayrollSettlementCase.where(source_time_entry_id: entry.id).count).to eq(1)
    expect(batch.reload.checksum).to eq(checksum)
  end

  it "F2 scopes coverage to relevant allocations and preserves other reconciliation work on legacy gaps" do
    old = historical_period
    legacy = direct_allocation(work_date: old.start_date + 2.days, status: "voided", created_at: old.cutoff_at - 1.day)
    modern_allocation = reserve
    modern = origin
    finalize(modern)
    release(modern_allocation)
    expect(PayrollSettlementCase.find_by!(source_time_entry_id: entry.id).origin_payroll_batch).to eq(modern.payroll_batch)
    late_old_entry = create(:time_entry, user: employee, work_date: old.start_date + 3.days,
      entry_method: "manual", status: "completed", approval_status: "pending")

    expect do
      Payroll::ManualReservationRelease.record_for_period!(period: old, batch: old.payroll_batch, allocations: [ legacy ])
    end.to raise_error(Payroll::ManualAllocationLedger::CoverageError)
    Payroll::SettlementCaseCoordinator.sync_finalized_periods!
    expect(PayrollSettlementCase.exists?(origin_payroll_batch: old.payroll_batch, source_time_entry_id: late_old_entry.id)).to be(true)
    expect(PayrollSettlementReconciliation.exists?(payroll_calendar_period: old)).to be(false)
  end

  [ :retained, :replacement, :moved_replacement, :moved_replacement_sync ].each do |component|
    it "F3 reopens full coverage when the #{component} component is cancelled, reissued and then released" do
      first = reserve(3)
      retained = reserve(5)
      period = origin
      batch = finalize(period)
      checksum = batch.checksum
      release(first)
      entry.update!(work_date: period.end_date + 2.days) if component.in?([ :moved_replacement, :moved_replacement_sync ])
      replacement = reserve(3)
      settlement = PayrollSettlementCase.find_by!(source_time_entry_id: entry.id)
      issue(retained, "retain-five")
      issue(replacement, "replace-three")
      expect(settlement.reload).to have_attributes(status: "settled", held_total_hours: 3)
      cancelled, reference = component == :retained ? [ retained, "retain-five" ] : [ replacement, "replace-three" ]

      cancel(cancelled, reference)
      expect(settlement.reload).to have_attributes(status: "in_payroll", resolved_at: nil)
      expect(PayrollManualAllocation.active.where(time_entry_id: entry.id).sum("regular_hours + overtime_hours")).to eq(8)
      expect(settlement.payroll_settlement_case_events.order(:id).last.metadata)
        .to include("manual_allocation_id" => cancelled.id.to_s, "committed_hours_retained" => true)
      issue(cancelled, "reissued-#{reference}")
      expect(settlement.reload.status).to eq("settled")
      cancel(cancelled, "reissued-#{reference}")
      if component == :moved_replacement_sync
        cancelled.update_columns(status: "voided", voided_at: database_clock)
        2.times { Payroll::SettlementCaseCoordinator.sync_finalized_periods! }
      else
        release(cancelled)
      end
      expect(settlement.reload).to have_attributes(status: "open", destination_kind: "unassigned", held_total_hours: cancelled.total_hours)
      expect(PayrollManualAllocation.active.where(time_entry_id: entry.id).sum("regular_hours + overtime_hours"))
        .to eq(8 - cancelled.total_hours)
      expect(batch.reload.checksum).to eq(checksum)
    end
  end

  it "F4 forbids model bulk deletion and direct SQL deletion of eventless reservations" do
    allocation = direct_allocation
    cutoff = capture_payroll_cutoff
    [ -> { PayrollManualAllocation.where(id: allocation.id).delete_all },
      -> { ActiveRecord::Base.connection.execute("DELETE FROM payroll_manual_allocations WHERE id = #{allocation.id}") } ].each do |delete|
      expect do
        PayrollManualAllocation.transaction(requires_new: true) { delete.call }
      end.to raise_error(ActiveRecord::StatementInvalid, /append-only/)
      expect(PayrollManualAllocation.exists?(allocation.id)).to be(true)
    end
    expect(Payroll::ManualAllocationLedger.active_at(cutoff, entry_ids: [ entry.id ]).map(&:id)).to eq([ allocation.id ])
    expect(Payroll::ManualAllocationLedger.active_at(capture_payroll_cutoff, entry_ids: [ entry.id ]).map(&:id)).to eq([ allocation.id ])
  end

  it "F4 forbids truncating the reservation projection and installs its own enabled guard" do
    allocation = direct_allocation
    trigger = ActiveRecord::Base.connection.select_value(<<~SQL)
      SELECT pg_get_triggerdef(oid) FROM pg_trigger
      WHERE tgrelid = 'payroll_manual_allocations'::regclass
        AND tgname = 'payroll_manual_allocations_prevent_truncate' AND tgenabled = 'O'
    SQL
    expect(trigger).to include("BEFORE TRUNCATE ON public.payroll_manual_allocations")
    expect do
      PayrollManualAllocation.transaction(requires_new: true) do
        ActiveRecord::Base.connection.execute("TRUNCATE payroll_manual_allocations CASCADE")
      end
    end.to raise_error(ActiveRecord::StatementInvalid, /append-only/)
    expect(allocation.reload.status).to eq("committed")
  end

  it "F4 DB-stamps bulk updates despite caller-supplied Rails and physical timestamps" do
    allocation = reserve
    cutoff = capture_payroll_cutoff
    physical = cutoff - 1.year
    allocation.update_columns(reason: "Synthetic bypass of model callbacks", created_at: physical, updated_at: physical)
    PayrollManualAllocation.where(id: allocation.id).update_all(status: "voided", voided_at: physical, updated_at: physical)
    ActiveRecord::Base.connection.execute("UPDATE payroll_manual_allocations SET reason = 'Direct SQL bypass' WHERE id = #{allocation.id}")
    revisions = PayrollManualAllocationRevision.where(payroll_manual_allocation_id: allocation.id).order(:id).to_a
    expect(revisions.size).to eq(4)
    expect(revisions.last(3).map(&:recorded_at)).to all(be > cutoff)
    expect(revisions.last.snapshot.fetch("status")).to eq("voided")
    expect(Payroll::ManualAllocationLedger.active_at(cutoff, entry_ids: [ entry.id ]).map(&:id)).to eq([ allocation.id ])
    expect(Payroll::ManualAllocationLedger.active_at(capture_payroll_cutoff, entry_ids: [ entry.id ])).to be_empty
  end
end
