# frozen_string_literal: true

require "rails_helper"
require_relative "../../support/payroll_clock_helpers"

RSpec.describe "Manual reservation component recovery" do
  include PayrollClockHelpers

  let(:actor) { create(:user, :admin) }
  let(:employee) { create(:user, :employee) }
  let(:recorder) { Payroll::ManualAllocationRecorder.new(actor: actor) }
  let(:entry) do
    create(:time_entry, user: employee, work_date: payroll_calendar_at(database_clock).fetch(:start_date) + 2.days,
      entry_method: "clock", status: "completed", approval_status: nil, overtime_status: "none")
  end

  def reserve(hours, period: "manual-original")
    recorder.commit!(entry: entry, source_user_uuid: employee.payroll_integration_uuid,
      regular_hours: hours, overtime_hours: 0, external_pay_period_id: period,
      external_payroll_item_id: SecureRandom.uuid, pay_date: database_clock.to_date.iso8601,
      reason: "Independent exact synthetic reservation")
  end

  def release(allocation)
    recorder.void!(allocation: allocation, occurred_at: database_clock.iso8601(6), reason: "Verified synthetic wage release")
  end

  def issue(allocation, reference)
    recorder.issue!(allocation: allocation, payment_method: "paper_check", payment_reference: reference,
      payment_effective_on: database_clock.to_date.iso8601, occurred_at: database_clock.iso8601(6), reason: "Synthetic verified issue")
  end

  def cancel(allocation, reference)
    recorder.cancel_payment!(allocation: allocation, payment_method: "paper_check", payment_reference: reference,
      payment_effective_on: database_clock.to_date.iso8601, occurred_at: database_clock.iso8601(6),
      reason: "Synthetic verified stop payment", cancellation_evidence_reference: "stop-#{reference}")
  end

  def finalize(period)
    wait_for_database_cutoff(period.cutoff_at)
    expect(Payroll::ScheduledCutoffFinalizer.new(period_id: period.id).call).to include(status: "finalized")
    period.reload.payroll_batch
  end

  def replacement_fixture
    first = reserve(3)
    retained = reserve(5)
    origin = create(:payroll_calendar_period, **payroll_calendar_at(capture_payroll_cutoff))
    batch = finalize(origin)
    before = batch.attributes
    release(first)
    entry.update!(work_date: origin.end_date + 2.days)
    replacement = reserve(3, period: "manual-replacement-different-payroll")
    settlement = PayrollSettlementCase.find_by!(source_time_entry_id: entry.id)
    [ origin, batch, before, settlement, retained, replacement ]
  end

  def release_via(path, replacement)
    if path == :recorder
      release(replacement)
    else
      replacement.update_columns(status: "voided", voided_at: database_clock)
    end
    2.times { Payroll::SettlementCaseCoordinator.sync_finalized_periods! }
  end

  def expect_recovery_and_export(origin, batch, before, settlement, retained, replacement)
    expect(batch.reload.attributes).to eq(before)
    expect(replacement.reload.status).to eq("voided")
    expect(settlement.reload).to have_attributes(status: "open", destination_kind: "unassigned",
      target_external_pay_period_id: nil, target_payroll_calendar_period_id: nil, included_payroll_batch_id: nil,
      held_total_hours: 3)
    releases = settlement.payroll_settlement_case_events
      .where("metadata ->> 'released_manual_allocation_id' = ?", replacement.id.to_s)
    expect(releases.count).to eq(1)
    expect(releases.first.metadata).to include("requires_explicit_routing" => true)
    expect(PayrollManualAllocation.active.where(time_entry_id: entry.id).sum("regular_hours + overtime_hours")).to eq(5)
    expect(PayrollSettlementCase.where(source_time_entry_id: entry.id).count).to eq(1)

    dates = payroll_calendar_for(next_payroll_start(origin.start_date))
    cutoff = database_clock + 1.second
    target = create(:payroll_calendar_period, **dates, schema_version: "2.0", cutoff_at: cutoff,
      next_finalization_attempt_at: cutoff, cutoff_days: (dates.fetch(:pay_date) - cutoff.to_date).to_i)
    Payroll::SettlementCaseRouter.new(settlement_case: settlement, destination_kind: "regular",
      target_external_pay_period_id: target.external_pay_period_id, action_due_on: target.pay_date.iso8601,
      assigned_to_id: actor.id, reason: "Explicitly route these exact three released hours to a future payroll", actor: actor).call
    future = finalize(target)
    expect(future.payroll_batch_entries.distinct.pluck(:source_time_entry_id)).to eq([ entry.id ])
    expect(future.payroll_batch_entries.sum(:total_hours)).to eq(3)
    rows_before = future.payroll_batch_entries.order(:id).map(&:attributes)
    2.times do
      expect(finalize(target).id).to eq(future.id)
      Payroll::SettlementCaseCoordinator.sync_finalized_periods!
      release(replacement.reload)
    end
    expect(settlement.reload.included_payroll_batch).to eq(future)
    expect(future.payroll_batch_entries.order(:id).map(&:attributes)).to eq(rows_before)
    expect(releases.count).to eq(1)
    expect(PayrollSettlementCase.where(source_time_entry_id: entry.id).count).to eq(1)
    expect(PayrollBatchEntry.where(source_time_entry_id: entry.id).sum(:total_hours)).to eq(3)
    expect(retained.reload.total_hours + future.payroll_batch_entries.sum(:total_hours)).to eq(8)
    expect(batch.reload.attributes).to eq(before)
  end

  [ :recorder, :periodic ].each do |path|
    [ :retained_last, :replacement_last ].each do |order|
      it "recovers a moved different-payroll component exactly once with #{order} through #{path}" do
        # Rehearse existing cases from before commitment membership was
        # recorded. These must recover from their durable settlement evidence.
        allow(Payroll::SettlementCaseCoordinator).to receive(:transition!).and_wrap_original do |original, *args, **kwargs|
          if kwargs[:event_type] == "committed"
            kwargs[:metadata] = kwargs.fetch(:metadata).except(:manual_allocation_component_ids)
          end
          original.call(*args, **kwargs)
        end
        origin, batch, before, settlement, retained, replacement = replacement_fixture
        components = [ [ replacement, "replacement-three" ], [ retained, "retained-five" ] ]
        components.reverse! if order == :replacement_last
        components.each { |component, reference| issue(component, reference) }
        expect(settlement.reload).to have_attributes(status: "settled",
          target_external_pay_period_id: components.last.first.external_pay_period_id)
        closing = settlement.payroll_settlement_case_events.order(:id).last
        expect(closing.metadata.fetch("manual_allocation_component_ids")).to include(replacement.id.to_s, retained.id.to_s)
        expect(settlement.payroll_settlement_case_events.where(event_type: "committed")
          .where("metadata ? 'manual_allocation_component_ids'")).not_to exist
        cancel(replacement, "replacement-three")
        expect(settlement.reload.status).to eq("in_payroll")

        release_via(path, replacement)
        expect_recovery_and_export(origin, batch, before, settlement, retained, replacement)
      end
    end

    it "recovers a moved different-payroll component before issuance through #{path}" do
      origin, batch, before, settlement, retained, replacement = replacement_fixture
      release_via(path, replacement)
      expect_recovery_and_export(origin, batch, before, settlement, retained, replacement)
    end
  end
end
