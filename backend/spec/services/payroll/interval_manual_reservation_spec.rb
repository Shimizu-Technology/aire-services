# frozen_string_literal: true

require "rails_helper"
require_relative "../../support/payroll_clock_helpers"

RSpec.describe "Interval allocations with manual reservation recovery" do
  include PayrollClockHelpers

  let(:actor) { create(:user, :admin) }
  let(:employee) { create(:user, :employee) }
  let(:category) { create(:time_category) }
  let(:zone) { ActiveSupport::TimeZone["Pacific/Guam"] }
  let(:date) { payroll_calendar_at(database_clock).fetch(:start_date) + 2.days }
  let(:entry) do
    start = zone.local(date.year, date.month, date.day, 8)
    create(:time_entry, user: employee, time_category: category, work_date: date,
      start_time: start, end_time: start + 8.hours, clock_in_at: start, clock_out_at: start + 8.hours,
      entry_method: "clock", status: "completed", approval_status: nil)
  end
  let(:recorder) { Payroll::ManualAllocationRecorder.new(actor: actor) }

  def reserve(hours)
    recorder.commit!(entry: entry, source_user_uuid: employee.payroll_integration_uuid,
      regular_hours: hours, overtime_hours: 0, external_pay_period_id: "interval-manual",
      external_payroll_item_id: SecureRandom.uuid, pay_date: database_clock.to_date.iso8601,
      reason: "Verified synthetic exact manual reservation")
  end

  def make_overnight
    start = zone.local(entry.work_date.year, entry.work_date.month, entry.work_date.day, 22)
    entry.update!(start_time: start, end_time: start + 8.hours, clock_in_at: start, clock_out_at: start + 8.hours)
  end

  def finalize(period)
    ActiveRecord::Base.uncached { wait_for_database_cutoff(period.cutoff_at) }
    expect(Payroll::ScheduledCutoffFinalizer.new(period_id: period.id).call).to include(status: "finalized")
    period.reload.payroll_batch
  end

  it "holds a new multi-date manual match without creating reservation history" do
    make_overnight
    expect { reserve(3) }.to raise_error(Payroll::ManualAllocationRecorder::Error, /multiple payable dates/)
    expect(PayrollManualAllocation.count).to eq(0)
    expect(PayrollManualAllocationRevision.count).to eq(0)
    expect(PayrollManualAllocationEvent.count).to eq(0)
    period = create(:payroll_calendar_period, **payroll_calendar_at(capture_payroll_cutoff))
    expect(finalize(period).payroll_batch_entries.order(:work_date).pluck(:work_date, :total_hours))
      .to eq([ [ date, 2 ], [ date + 1, 6 ] ])
  end

  it "fences the receiving cutoff when only the Sunday portion overlaps its pay period" do
    # A version-2 publication can lock a Sunday-start month now. Keep its
    # pay date ahead of the real DB clock rather than backdating revisions.
    receiving = database_clock.to_date.next_month.beginning_of_month
    receiving = receiving.next_month until receiving.sunday?
    saturday = receiving - 1
    entry.update!(work_date: saturday)
    make_overnight
    cutoff = capture_payroll_cutoff
    period = create(:payroll_calendar_period, start_date: receiving, end_date: receiving.change(day: 15),
      pay_date: receiving.change(day: 25), schema_version: "2.0", cutoff_at: cutoff,
      cutoff_rule: "after_previous_regular_payday", previous_regular_pay_date: cutoff.to_date - 1,
      cutoff_days: 1, next_finalization_attempt_at: cutoff)
    expect { reserve(3) }.to raise_error(Payroll::ManualAllocationRecorder::ClaimConflictError, /cutoff.*reconcile/)
    entry.update!(work_date: receiving - 3)
    make_overnight
    expect { reserve(3) }.to raise_error(Payroll::ManualAllocationRecorder::ClaimConflictError, /cutoff.*reconcile/)
    expect(PayrollManualAllocation.count).to eq(0)
    expect(finalize(period).payroll_batch_entries.sum(:total_hours)).to eq(8)
  end

  [ :recorder, :periodic ].each do |path|
    it "recovers released components after an overnight edit through #{path}, retaining cutoff history" do
      released = reserve(3)
      retained = reserve(5)
      period = create(:payroll_calendar_period, **payroll_calendar_at(capture_payroll_cutoff))
      original_preview = Payroll::BatchBuilder.new(start_date: period.start_date, end_date: period.end_date,
        cutoff_at: period.cutoff_at, calendar_period: period).call
      make_overnight
      expect { reserve(1) }.to raise_error(Payroll::ManualAllocationRecorder::Error, /multiple payable dates/)
      original = finalize(period)
      frozen = original.attributes
      expect(original.payroll_batch_entries).to be_empty
      unchanged_preview = Payroll::BatchBuilder.new(start_date: period.start_date, end_date: period.end_date,
        cutoff_at: period.cutoff_at, calendar_period: period).call
      expect(unchanged_preview.fetch(:checksum)).to eq(original_preview.fetch(:checksum))
      if path == :recorder
        recorder.void!(allocation: released, occurred_at: database_clock.iso8601(6), reason: "Verified unissued component release")
      else
        released.update_columns(status: "voided", voided_at: database_clock)
      end
      2.times { Payroll::SettlementCaseCoordinator.sync_finalized_periods! }
      settlement = PayrollSettlementCase.find_by!(source_time_entry_id: entry.id)
      expect(settlement).to have_attributes(status: "open", destination_kind: "unassigned", held_total_hours: 3)
      expect(settlement.payroll_settlement_case_events.where("metadata ->> 'released_manual_allocation_id' = ?", released.id.to_s).count).to eq(1)
      dates = payroll_calendar_for(next_payroll_start(period.start_date))
      cutoff = database_clock + 1.second
      target = create(:payroll_calendar_period, **dates, schema_version: "2.0", cutoff_at: cutoff,
        next_finalization_attempt_at: cutoff, cutoff_days: (dates.fetch(:pay_date) - cutoff.to_date).to_i)
      Payroll::SettlementCaseRouter.new(settlement_case: settlement, destination_kind: "regular",
        target_external_pay_period_id: target.external_pay_period_id, action_due_on: target.pay_date.iso8601,
        assigned_to_id: actor.id, reason: "Reviewed overnight exact dimensions and routed released component", actor: actor).call
      recovered = finalize(target)
      expect(recovered.payroll_batch_entries.order(:work_date).pluck(:work_date, :regular_hours, :overtime_hours))
        .to eq([ [ date, -3, 0 ], [ date + 1, 6, 0 ] ])
      expect(retained.reload.total_hours + recovered.payroll_batch_entries.sum(:total_hours)).to eq(8)
      2.times { Payroll::SettlementCaseCoordinator.sync_finalized_periods! }
      expect(finalize(target).id).to eq(recovered.id)
      expect(original.reload.attributes).to eq(frozen)
      expect(settlement.reload.included_payroll_batch).to eq(recovered)
      expect(PayrollManualAllocationRevision.where(payroll_manual_allocation_id: released.id).count).to eq(2)
    end
  end

  it "retains a manual payment's regular classification while replacement OT awaits review" do
    sunday = date.beginning_of_week(:sunday)
    entry.update!(work_date: sunday + 5)
    4.times do |i|
      start = zone.local(sunday.year, sunday.month, sunday.day, 8) + (i + 1).days
      create(:time_entry, user: employee, time_category: category, work_date: sunday + i + 1,
        start_time: start, end_time: start + 8.hours, entry_method: "clock", status: "completed", approval_status: nil)
    end
    reserve(8)
    start = zone.local(sunday.year, sunday.month, sunday.day, 8)
    earlier = create(:time_entry, user: employee, time_category: category, work_date: sunday,
      start_time: start, end_time: start + 8.hours, entry_method: "clock", status: "completed", approval_status: "pending")
    TimeClockService.approve_entry(entry: earlier, approved_by: actor)
    expect(entry.reload.overtime_status).to eq("pending")
    result = Payroll::BatchBuilder.new(start_date: sunday, end_date: sunday + 6).call
    expect(result[:rows].select { |row| row[:source_time_entry_id] == entry.id }).to be_empty
    expect(result[:exclusions]).to include(include(source_time_entry_id: entry.id, reason: "pending_overtime"))
  end
end
