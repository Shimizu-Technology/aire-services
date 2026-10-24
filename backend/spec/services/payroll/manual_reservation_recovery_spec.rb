# frozen_string_literal: true

require "rails_helper"
require_relative "../../support/payroll_clock_helpers"

RSpec.describe "Manual reservation cutoff recovery" do
  include PayrollClockHelpers

  let(:actor) { create(:user, :admin) }
  let(:employee) { create(:user, :employee) }
  let(:recorder) { Payroll::ManualAllocationRecorder.new(actor: actor) }
  let(:dates) { payroll_calendar_at(database_clock) }
  let(:entry) do
    create(:time_entry, user: employee, work_date: dates.fetch(:start_date) + 2.days,
      entry_method: "clock", status: "completed", approval_status: nil, overtime_status: "none")
  end

  def reserve(hours = 8, item: SecureRandom.uuid)
    recorder.commit!(entry: entry, source_user_uuid: employee.payroll_integration_uuid,
      regular_hours: hours, overtime_hours: 0, external_pay_period_id: "manual-review",
      external_payroll_item_id: item, pay_date: database_clock.to_date.iso8601,
      reason: "Verified exact synthetic manual payroll commitment")
  end

  def origin_period
    entry
    create(:payroll_calendar_period, **payroll_calendar_at(capture_payroll_cutoff))
  end

  def finalize(period)
    wait_for_database_cutoff(period.cutoff_at)
    result = Payroll::ScheduledCutoffFinalizer.new(period_id: period.id).call
    expect(result).to include(status: "finalized")
    period.reload.payroll_batch
  end

  def preview(period)
    Payroll::BatchBuilder.new(start_date: period.start_date, end_date: period.end_date,
      cutoff_at: period.cutoff_at, calendar_period: period).call
  end

  def release(allocation)
    recorder.void!(allocation: allocation, occurred_at: database_clock.iso8601(6),
      reason: "Verified unissued commitment cancelled; review future payroll")
  end

  def target_period(origin)
    attributes = payroll_calendar_for(next_payroll_start(origin.start_date))
    cutoff = database_clock + 1.second
    create(:payroll_calendar_period, **attributes, schema_version: "2.0",
      cutoff_at: cutoff, next_finalization_attempt_at: cutoff,
      cutoff_days: (attributes.fetch(:pay_date) - cutoff.to_date).to_i)
  end

  def route(settlement, target, destination: "regular")
    Payroll::SettlementCaseRouter.new(settlement_case: settlement, destination_kind: destination,
      target_external_pay_period_id: target.external_pay_period_id, action_due_on: target.pay_date.iso8601,
      assigned_to_id: actor.id, reason: "Reviewed exact released hours and selected their disposition", actor: actor).call
  end

  it "requires explicit future routing after a zero-line cutoff and exports the released eight hours exactly once" do
    allocation = reserve
    origin = origin_period
    original = finalize(origin)
    checksum = original.checksum
    expect(original.summary.fetch("total_hours")).to eq(0)
    expect(original.payroll_batch_exclusions).to be_empty

    release(allocation)
    settlement = PayrollSettlementCase.find_by!(source_time_entry_id: entry.id)
    expect(settlement).to have_attributes(status: "open", destination_kind: "unassigned", held_total_hours: 8)
    expect(settlement.payroll_settlement_case_events.order(:id).last.metadata).to include("requires_explicit_routing" => true)
    2.times { Payroll::SettlementCaseCoordinator.sync_finalized_periods! }
    expect { release(allocation.reload) }.not_to change(PayrollSettlementCase, :count)
    expect(PayrollSettlementCase.where(source_time_entry_id: entry.id).count).to eq(1)

    target = target_period(origin)
    Payroll::SettlementCaseCoordinator.prepare_for_period!(target)
    expect(preview(target).dig(:summary, :total_hours)).to eq(0)
    route(settlement, target)
    recovered = finalize(target)
    expect(recovered.summary.fetch("total_hours")).to eq(8)
    expect(recovered.payroll_batch_entries.pluck(:source_time_entry_id, :total_hours)).to eq([ [ entry.id, 8 ] ])
    expect(settlement.reload.included_payroll_batch).to eq(recovered)
    expect(finalize(target).id).to eq(recovered.id)
    expect(original.reload.checksum).to eq(checksum)
    expect(PayrollBatchEntry.where(source_time_entry_id: entry.id).sum(:total_hours)).to eq(8)
  end

  it "rejects a new manual claim on a due cutoff and preserves its checksum and lines" do
    origin = origin_period
    before = preview(origin)
    expect(before.dig(:summary, :total_hours)).to eq(8)
    expect { reserve }.to raise_error(Payroll::ManualAllocationRecorder::Error, /cutoff.*reconcil/i)
    expect(PayrollManualAllocation.count).to eq(0)
    expect(preview(origin).values_at(:checksum, :rows)).to eq(before.values_at(:checksum, :rows))
    finalize(origin)
    expect { reserve }.to raise_error(Payroll::ManualAllocationRecorder::Error, /exceed/)
    expect(PayrollBatchEntry.sum(:total_hours)).to eq(8)
  end

  it "keeps a pre-cutoff reservation in the delayed snapshot after a physically backdated void" do
    allocation = reserve
    origin = origin_period
    before = preview(origin)
    recorder.void!(allocation: allocation, occurred_at: (origin.cutoff_at - 1.day).iso8601(6),
      reason: "Physical cancellation reported after the cutoff; recording instant governs")
    expect(preview(origin).values_at(:checksum, :rows)).to eq(before.values_at(:checksum, :rows))
    expect(finalize(origin).summary.fetch("total_hours")).to eq(0)
    2.times { Payroll::SettlementCaseCoordinator.sync_finalized_periods! }
    expect(PayrollSettlementCase.find_by!(source_time_entry_id: entry.id)).to have_attributes(status: "open", destination_kind: "unassigned")
  end

  it "releases only one of two reservations without reoffering the retained hours" do
    first = reserve(3)
    second = reserve(5)
    origin = origin_period
    original = finalize(origin)
    release(first)
    settlement = PayrollSettlementCase.find_by!(source_time_entry_id: entry.id)
    expect(settlement.held_total_hours).to eq(3)
    target = target_period(origin)
    route(settlement, target)
    recovered = finalize(target)
    expect(recovered.summary.fetch("total_hours")).to eq(3)
    expect(second.reload.status).to eq("committed")
    expect(original.reload.summary.fetch("total_hours")).to eq(0)
    release(second)
    expect(settlement.reload).to have_attributes(status: "open", destination_kind: "unassigned", held_total_hours: 5)
    expect(PayrollSettlementCase.where(source_time_entry_id: entry.id).count).to eq(1)
  end

  it "exports the partial remainder at origin and only the released balance later, including a source edit" do
    allocation = reserve(3)
    origin = origin_period
    original = finalize(origin)
    checksum = original.checksum
    expect(original.summary.fetch("total_hours")).to eq(5)
    entry.update!(end_time: entry.end_time + 1.hour)
    release(allocation)
    target = target_period(origin)
    route(PayrollSettlementCase.find_by!(source_time_entry_id: entry.id), target)
    expect(finalize(target).summary.fetch("total_hours")).to eq(4)
    expect(original.reload.checksum).to eq(checksum)
    expect(PayrollBatchEntry.where(source_time_entry_id: entry.id).sum(:total_hours)).to eq(9)
  end

  it "retains cancelled payment hours until verified cancellation is followed by an explicit wage release" do
    allocation = reserve
    recorder.issue!(allocation: allocation, payment_method: "paper_check", payment_reference: "synthetic-1",
      payment_effective_on: database_clock.to_date.iso8601, occurred_at: database_clock.iso8601(6), reason: "Verified synthetic delivery evidence")
    origin = origin_period
    original = finalize(origin)
    expect { release(allocation) }.to raise_error(Payroll::ManualAllocationRecorder::Error, /Issued hours/)
    recorder.cancel_payment!(allocation: allocation, payment_method: "paper_check", payment_reference: "synthetic-1",
      payment_effective_on: database_clock.to_date.iso8601, occurred_at: database_clock.iso8601(6),
      reason: "Verified synthetic stop payment evidence", cancellation_evidence_reference: "synthetic-bank-stop")
    expect(PayrollSettlementCase.count).to eq(0)
    expect(preview(origin).dig(:summary, :total_hours)).to eq(0)
    release(allocation)
    target = target_period(origin)
    route(PayrollSettlementCase.find_by!(source_time_entry_id: entry.id), target)
    expect(finalize(target).summary.fetch("total_hours")).to eq(8)
    expect(original.reload.summary.fetch("total_hours")).to eq(0)
  end

  it "honors an explicit not-payable disposition instead of auto-routing a release" do
    allocation = reserve
    origin = origin_period
    finalize(origin)
    release(allocation)
    target = target_period(origin)
    settlement = PayrollSettlementCase.find_by!(source_time_entry_id: entry.id)
    route(settlement, target, destination: "not_payable")
    2.times { Payroll::SettlementCaseCoordinator.sync_finalized_periods! }
    expect(settlement.reload.status).to eq("not_payable")
    expect(finalize(target).summary.fetch("total_hours")).to eq(0)
  end
  it "keeps post-cutoff reservation creation and void out of an originally held snapshot" do
    entry.update!(entry_method: "manual", approval_status: "pending")
    origin = origin_period
    before = preview(origin)
    entry.update!(approval_status: "approved", approved_at: database_clock)
    allocation = reserve
    expect(preview(origin).values_at(:checksum, :rows, :exclusions)).to eq(before.values_at(:checksum, :rows, :exclusions))
    release(allocation)
    expect(preview(origin).values_at(:checksum, :rows, :exclusions)).to eq(before.values_at(:checksum, :rows, :exclusions))
    expect(finalize(origin).summary.fetch("total_hours")).to eq(0)
  end

  it "fences the original due obligation even after the live source work date moves" do
    origin = origin_period
    entry.update!(work_date: origin.end_date + 2.days)
    expect { reserve }.to raise_error(Payroll::ManualAllocationRecorder::Error, /cutoff.*reconcil/i)
    expect(finalize(origin).summary.fetch("total_hours")).to eq(8)
    expect(PayrollManualAllocation.count).to eq(0)
  end

  it "records reservation revisions by database time and preserves immutable evidence" do
    before = capture_payroll_cutoff
    allocation = reserve
    revision = PayrollManualAllocationRevision.find_by!(payroll_manual_allocation_id: allocation.id)
    expect(revision.recorded_at).to be > before
    expect(revision.snapshot).to include("regular_hours" => 8.0, "status" => "committed")
    expect(Payroll::ManualAllocationLedger.active_at(before, entry_ids: [ entry.id ])).to be_empty
    release(allocation)
    expect(Payroll::ManualAllocationLedger.active_at(revision.recorded_at, entry_ids: [ entry.id ]).map(&:id)).to eq([ allocation.id ])
    expect(Payroll::ManualAllocationLedger.active_at(capture_payroll_cutoff, entry_ids: [ entry.id ])).to be_empty
    expect(revision).to be_readonly
    expect do
      PayrollManualAllocationRevision.transaction(requires_new: true) do
        PayrollManualAllocationRevision.where(id: revision.id).update_all(recorded_at: before)
      end
    end.to raise_error(ActiveRecord::StatementInvalid, /append-only/)
  end

  it "does not let a retained issued component settle a newly released unpaid component" do
    first = reserve(3)
    second = reserve(5)
    [ first, second ].each_with_index do |allocation, index|
      recorder.issue!(allocation: allocation, payment_method: "paper_check", payment_reference: "partial-#{index}",
        payment_effective_on: database_clock.to_date.iso8601, occurred_at: database_clock.iso8601(6), reason: "Verified synthetic partial delivery")
    end
    origin = origin_period
    finalize(origin)
    [ first, second ].each_with_index do |allocation, index|
      recorder.cancel_payment!(allocation: allocation, payment_method: "paper_check", payment_reference: "partial-#{index}",
        payment_effective_on: database_clock.to_date.iso8601, occurred_at: database_clock.iso8601(6),
        reason: "Verified synthetic partial stop payment", cancellation_evidence_reference: "partial-stop-#{index}")
      release(first) if index.zero?
    end
    replacement = reserve(3)
    settlement = PayrollSettlementCase.find_by!(source_time_entry_id: entry.id)
    recorder.issue!(allocation: second, payment_method: "paper_check", payment_reference: "retained-replacement",
      payment_effective_on: database_clock.to_date.iso8601, occurred_at: database_clock.iso8601(6), reason: "Verified retained component replacement delivery")
    expect(settlement.reload.status).not_to eq("settled")
    expect(replacement.reload.status).to eq("committed")
    recorder.issue!(allocation: replacement, payment_method: "paper_check", payment_reference: "released-replacement",
      payment_effective_on: database_clock.to_date.iso8601, occurred_at: database_clock.iso8601(6), reason: "Verified released component replacement delivery")
    expect(settlement.reload.status).to eq("settled")
  end
  it "requires reconciliation instead of inventing evidence before the first trusted legacy snapshot" do
    entry
    cutoff = capture_payroll_cutoff
    allocation = PayrollManualAllocation.create!(time_entry: entry, user: employee, recorded_by: actor,
      source_user_uuid: employee.payroll_integration_uuid, source_time_entry_version: entry.lock_version,
      work_date: entry.work_date, pay_date: database_clock.to_date, regular_hours: 8, overtime_hours: 0,
      external_pay_period_id: "legacy", external_payroll_item_id: "legacy-item", reason: "Synthetic legacy migration snapshot",
      created_at: cutoff - 1.day)
    expect(PayrollManualAllocationRevision.find_by!(payroll_manual_allocation_id: allocation.id).recorded_at).to be > cutoff
    expect { Payroll::ManualAllocationLedger.active_at(cutoff, entry_ids: [ entry.id ]) }
      .to raise_error(Payroll::ManualAllocationLedger::CoverageError, /reconcile legacy/)
  end
end
