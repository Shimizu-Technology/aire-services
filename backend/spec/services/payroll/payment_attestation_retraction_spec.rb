# frozen_string_literal: true

require "rails_helper"

RSpec.describe "Payment attestation retraction in V2 calendars" do
  include ActiveSupport::Testing::TimeHelpers

  let(:guam) { ActiveSupport::TimeZone["Pacific/Guam"] }
  let(:actor) { create(:user, :admin) }
  let(:employee) { create(:user, :employee) }
  let(:recorder) { Payroll::PaymentAttestationRecorder.new(actor: actor) }
  let(:reason) { "Owner corrected the payment statement after reviewing the original check evidence." }

  def period(start_date, payday, previous_payday)
    cutoff = previous_payday + 7.days
    create(:payroll_calendar_period,
           start_date: start_date, end_date: start_date.day == 1 ? start_date.change(day: 15) : start_date.end_of_month,
           pay_date: payday, schema_version: "2.0", cutoff_rule: "after_previous_regular_payday",
           cutoff_days: 7, previous_regular_pay_date: previous_payday,
           cutoff_at: guam.local(cutoff.year, cutoff.month, cutoff.day, 17),
           next_finalization_attempt_at: guam.local(cutoff.year, cutoff.month, cutoff.day, 17))
  end

  def held_case_fixture
    origin = period(Date.new(2026, 10, 1), Date.new(2026, 10, 31), Date.new(2026, 10, 15))
    old_target = period(Date.new(2026, 10, 16), Date.new(2026, 11, 15), Date.new(2026, 10, 31))
    target = period(Date.new(2026, 11, 1), Date.new(2026, 11, 30), Date.new(2026, 11, 15))
    entry = create(:time_entry, user: employee, work_date: Date.new(2026, 10, 3),
                   entry_method: "manual", status: "completed", approval_status: "pending", overtime_status: "none",
                   created_at: guam.local(2026, 10, 3, 17), updated_at: guam.local(2026, 10, 3, 17))
    travel_to(origin.cutoff_at + 1.minute) do
      expect(Payroll::ScheduledCutoffFinalizer.new(period_id: origin.id).call.fetch(:status)).to eq("finalized")
      entry.update!(approval_status: "approved", approved_by: actor, approved_at: Time.current)
    end
    settlement_case = PayrollSettlementCase.find_by!(origin_payroll_batch: origin.reload.payroll_batch, source_time_entry_id: entry.id)
    expect(settlement_case.target_payroll_calendar_period).to eq(old_target)
    [ origin, old_target, target, entry, settlement_case ]
  end

  def preview(target)
    Payroll::BatchBuilder.new(start_date: target.start_date, end_date: target.end_date,
                              cutoff_at: target.cutoff_at, calendar_period: target).call
  end

  def route(settlement_case, target)
    Payroll::SettlementCaseRouter.new(
      settlement_case: settlement_case, destination_kind: "regular",
      target_external_pay_period_id: target.external_pay_period_id, action_due_on: target.pay_date.iso8601,
      assigned_to_id: actor.id, reason: "Reviewed current source identity and unpaid hours; route to this unlocked cutoff", actor: actor
    ).call
  end

  it "returns old held work to explicit review and then previews and finalizes its named future destination" do
    origin, old_target, target, entry, settlement_case = held_case_fixture
    origin_checksum = origin.payroll_batch.checksum
    travel_to(origin.cutoff_at + 1.hour) do
      attestation = recorder.attest!(entry: entry, source_user_uuid: employee.payroll_integration_uuid,
                                    reason: "Owner reported payment; the physical check evidence has not been verified")
      expect(settlement_case.reload.status).to eq("superseded")
      travel_back
      travel_to(old_target.cutoff_at + 1.minute)
      entry.update!(description: "Source correction requiring fresh review")
      recorder.retract!(attestation: attestation.reload, reason: reason)

      expect(settlement_case.reload).to have_attributes(
        status: "open", destination_kind: "unassigned", target_payroll_calendar_period_id: nil,
        target_external_pay_period_id: nil, included_payroll_batch_id: nil, resolved_at: nil, assigned_to_id: actor.id
      )
      event = settlement_case.payroll_settlement_case_events.order(:id).last
      expect(event).to have_attributes(event_type: "rerouted", from_status: "superseded", to_status: "open", actor_id: actor.id)
      expect(event.metadata).to include(
        "reason" => "payment_attestation_retracted", "payment_attestation_id" => attestation.id,
        "requires_explicit_routing" => true, "source_review_required" => true,
        "current_source_time_entry_version" => entry.lock_version
      )
      expect(settlement_case.resolution_note).to include("Review current source identity", reason)
      settlement_case.payroll_settlement_case_events.create!(
        event_id: SecureRandom.uuid, event_type: "approval_changed", from_status: "open", to_status: "open",
        occurred_at: Time.current, metadata: { reason: "Source approval reviewed after retraction" }
      )
      Payroll::SettlementCaseCoordinator.prepare_for_period!(target)
      expect(settlement_case.reload.status).to eq("open")
      expect(preview(target).fetch(:rows)).to be_empty
      expect { route(settlement_case, old_target) }.to raise_error(Payroll::SettlementCaseRouter::RoutingError, /cutoff has not passed/)

      route(settlement_case, target)
      result = preview(target)
      expect(result.fetch(:rows).map { |row| row.fetch(:source_time_entry_id) }).to eq([ entry.id ])
      expect(result.dig(:summary, :total_hours)).to eq(8.0)
      expect(result.fetch(:rows).sole).to include(work_date: entry.work_date, source_kind: "carryover")
    end

    travel_to(target.cutoff_at + 1.minute) do
      expect(Payroll::ScheduledCutoffFinalizer.new(period_id: target.id).call.fetch(:status)).to eq("finalized")
    end
    batch = target.reload.payroll_batch
    expect(batch.payroll_batch_entries.sole).to have_attributes(source_time_entry_id: entry.id, total_hours: 8, work_date: entry.work_date)
    expect(settlement_case.reload).to have_attributes(status: "in_payroll", included_payroll_batch_id: batch.id)
    expect(origin.payroll_batch.reload.checksum).to eq(origin_checksum)
    expect(origin.payroll_batch.payroll_batch_entries).to be_empty
    expect(PayrollEntryProcessingEvent.count).to eq(0)
    expect(PayrollManualAllocation.count).to eq(0)
  end

  it "routes work held before its first cutoff after retraction" do
    origin = period(Date.new(2026, 10, 1), Date.new(2026, 10, 31), Date.new(2026, 10, 15))
    target = period(Date.new(2026, 10, 16), Date.new(2026, 11, 15), Date.new(2026, 10, 31))
    entry = nil
    attestation = nil
    travel_to(guam.local(2026, 10, 3, 17)) do
      entry = create(:time_entry, user: employee, work_date: Date.new(2026, 10, 3),
                     entry_method: "manual", status: "completed", approval_status: "approved", approved_at: Time.current)
      attestation = recorder.attest!(entry: entry, source_user_uuid: employee.payroll_integration_uuid,
                                    reason: "Owner reported payment before any cutoff; check evidence remains pending")
    end
    travel_to(origin.cutoff_at + 1.minute) do
      expect(preview(origin).fetch(:exclusions).sole.fetch(:reason)).to eq("pending_payment_attestation")
      expect(Payroll::ScheduledCutoffFinalizer.new(period_id: origin.id).call.fetch(:status)).to eq("finalized")
      expect(origin.reload.payroll_batch.payroll_batch_entries).to be_empty
      held_case = PayrollSettlementCase.find_by!(origin_payroll_batch: origin.payroll_batch, source_time_entry_id: entry.id)
      expect(held_case.status).to eq("superseded")
      recorder.retract!(attestation: attestation, reason: reason)
      expect(held_case.reload).to have_attributes(status: "open", destination_kind: "unassigned")
      expect(held_case.payroll_settlement_case_events.order(:id).last.metadata).to include("requires_explicit_routing" => true)
      expect(preview(target).fetch(:rows)).to be_empty
      route(held_case, target)
      expect(preview(target).dig(:summary, :total_hours)).to eq(8.0)
    end
    travel_to(target.cutoff_at + 1.minute) do
      expect(Payroll::ScheduledCutoffFinalizer.new(period_id: target.id).call.fetch(:status)).to eq("finalized")
    end
    expect(target.reload.payroll_batch.payroll_batch_entries.sole).to have_attributes(source_time_entry_id: entry.id, total_hours: 8)
    expect(PayrollEntryProcessingEvent.count).to eq(0)
  end

  it "retains cutoff-held hours when retraction precedes the delayed first finalizer" do
    origin = period(Date.new(2026, 10, 1), Date.new(2026, 10, 31), Date.new(2026, 10, 15))
    target = period(Date.new(2026, 10, 16), Date.new(2026, 11, 15), Date.new(2026, 10, 31))
    entry = nil
    attestation = nil
    travel_to(guam.local(2026, 10, 3, 17)) do
      entry = create(:time_entry, user: employee, work_date: Date.new(2026, 10, 3),
                     entry_method: "manual", status: "completed", approval_status: "approved", approved_at: Time.current)
      attestation = recorder.attest!(entry: entry, source_user_uuid: employee.payroll_integration_uuid,
                                    reason: "Owner reported payment before cutoff; check evidence still requires review")
    end
    travel_to(origin.cutoff_at + 1.minute) do
      recorder.retract!(attestation: attestation, reason: reason)
      expect(origin.reload.payroll_batch_id).to be_nil
      expect(preview(origin).fetch(:rows)).to be_empty
      expect(preview(origin).fetch(:exclusions).sole.fetch(:reason)).to eq("pending_payment_attestation")
      expect(Payroll::ScheduledCutoffFinalizer.new(period_id: origin.id).call.fetch(:status)).to eq("finalized")
      batch = origin.reload.payroll_batch
      expect(batch.payroll_batch_entries).to be_empty
      expect(batch.payroll_batch_exclusions.sole.reason).to eq("pending_payment_attestation")
      held_case = PayrollSettlementCase.find_by!(origin_payroll_batch: batch, source_time_entry_id: entry.id)
      expect(held_case).to have_attributes(status: "open", destination_kind: "unassigned", assigned_to_id: actor.id)
      expect(held_case.payroll_settlement_case_events.order(:id).last.metadata).to include(
        "requires_explicit_routing" => true, "source_review_required" => true, "payment_attestation_id" => attestation.id
      )
      Payroll::SettlementCaseCoordinator.prepare_for_period!(target)
      expect(held_case.reload.status).to eq("open")
      expect(preview(target).fetch(:rows)).to be_empty
      route(held_case, target)
      expect(preview(target).dig(:summary, :total_hours)).to eq(8.0)
      expect(preview(target).fetch(:rows).sole).to include(source_time_entry_id: entry.id, source_kind: "carryover")
    end
    checksum = origin.payroll_batch.checksum
    travel_to(target.cutoff_at + 1.minute) do
      2.times { expect(Payroll::ScheduledCutoffFinalizer.new(period_id: target.id).call.fetch(:status)).to eq("finalized") }
    end
    expect(target.reload.payroll_batch.payroll_batch_entries.sole).to have_attributes(source_time_entry_id: entry.id, total_hours: 8)
    expect(PayrollBatchEntry.where(source_time_entry_id: entry.id).sum(:total_hours)).to eq(8)
    expect(origin.payroll_batch.reload.checksum).to eq(checksum)
    expect(origin.payroll_batch.payroll_batch_entries).to be_empty
    expect(PayrollEntryProcessingEvent.count).to eq(0)
    expect(PayrollManualAllocation.count).to eq(0)
  end

  it "admits a hold retracted before cutoff but retains a later hold through delayed finalization" do
    origin = period(Date.new(2026, 10, 1), Date.new(2026, 10, 31), Date.new(2026, 10, 15))
    released_entry = nil
    later_entry = nil
    travel_to(guam.local(2026, 10, 3, 17)) do
      released_entry = create(:time_entry, user: employee, work_date: Date.new(2026, 10, 3),
                              entry_method: "manual", status: "completed", approval_status: "approved", approved_at: Time.current)
      later_entry = create(:time_entry, user: employee, work_date: Date.new(2026, 10, 4),
                           entry_method: "manual", status: "completed", approval_status: "approved", approved_at: Time.current)
      attestation = recorder.attest!(entry: released_entry, source_user_uuid: employee.payroll_integration_uuid,
                                    reason: "Owner reported payment before cutoff; original check evidence remains pending")
      recorder.retract!(attestation: attestation, reason: reason)
    end
    travel_to(origin.cutoff_at + 1.minute) do
      later_hold = recorder.attest!(entry: later_entry, source_user_uuid: employee.payroll_integration_uuid,
                                   reason: "Owner reported payment while finalization was delayed; evidence remains pending")
      expect(preview(origin).fetch(:rows).map { |row| row.fetch(:source_time_entry_id) }).to eq([ released_entry.id ])
      recorder.retract!(attestation: later_hold, reason: reason)
      expect(Payroll::ScheduledCutoffFinalizer.new(period_id: origin.id).call.fetch(:status)).to eq("finalized")
    end
    batch = origin.reload.payroll_batch
    expect(batch.payroll_batch_entries.sole).to have_attributes(source_time_entry_id: released_entry.id, total_hours: 8)
    expect(batch.payroll_batch_exclusions.sole).to have_attributes(source_time_entry_id: later_entry.id, reason: "pending_payment_attestation")
    expect(PayrollSettlementCase.find_by!(origin_payroll_batch: batch, source_time_entry_id: later_entry.id))
      .to have_attributes(status: "open", destination_kind: "unassigned")
    expect(PayrollEntryProcessingEvent.count).to eq(0)
  end

  it "creates explicit review for a legacy frozen period that omitted the held source" do
    origin = period(Date.new(2026, 10, 1), Date.new(2026, 10, 31), Date.new(2026, 10, 15))
    target = period(Date.new(2026, 10, 16), Date.new(2026, 11, 15), Date.new(2026, 10, 31))
    entry = nil
    attestation = nil
    travel_to(guam.local(2026, 10, 3, 17)) do
      entry = create(:time_entry, user: employee, work_date: Date.new(2026, 10, 3),
                     entry_method: "manual", status: "completed", approval_status: "approved", approved_at: Time.current)
      attestation = recorder.attest!(entry: entry, source_user_uuid: employee.payroll_integration_uuid,
                                    reason: "Owner reported payment before any cutoff; original evidence still pending")
    end
    travel_to(origin.cutoff_at + 1.minute) do
      batch = create(:payroll_batch, start_date: origin.start_date, end_date: origin.end_date, cutoff_at: origin.cutoff_at)
      origin.update!(status: "finalized", payroll_batch: batch, finalized_at: Time.current)
      recorder.retract!(attestation: attestation, reason: reason)
      held_case = PayrollSettlementCase.active.find_by!(origin_payroll_batch: batch, source_time_entry_id: entry.id)
      expect(held_case).to have_attributes(status: "open", destination_kind: "unassigned")
      expect(held_case.payroll_settlement_case_events.order(:id).last.metadata).to include("requires_explicit_routing" => true)
      expect(preview(target).fetch(:rows)).to be_empty
      route(held_case, target)
      expect(preview(target).dig(:summary, :total_hours)).to eq(8.0)
      expect(batch.payroll_batch_entries).to be_empty
      expect(batch.payroll_batch_exclusions).to be_empty
    end
  end

  [ [ "open", "changed_after_cutoff" ], [ "superseded", "pending_payment_attestation" ] ].each do |status, origin_reason|
    it "preserves a concurrently returned #{status} #{origin_reason} fallback case" do
      origin = period(Date.new(2026, 10, 1), Date.new(2026, 10, 31), Date.new(2026, 10, 15))
      entry = nil
      attestation = nil
      travel_to(guam.local(2026, 10, 3, 17)) do
        entry = create(:time_entry, user: employee, work_date: Date.new(2026, 10, 3),
                       entry_method: "manual", status: "completed", approval_status: "approved", approved_at: Time.current)
        attestation = recorder.attest!(entry: entry, source_user_uuid: employee.payroll_integration_uuid,
                                      reason: "Owner reported payment before cutoff; original evidence still requires review")
      end
      travel_to(origin.cutoff_at + 1.minute) do
        batch = create(:payroll_batch, start_date: origin.start_date, end_date: origin.end_date, cutoff_at: origin.cutoff_at)
        origin.update!(status: "finalized", payroll_batch: batch, finalized_at: Time.current)
        returned_case = nil
        allow(Payroll::SettlementCaseCoordinator).to receive(:create_case!) do
          returned_case = create(:payroll_settlement_case, origin_payroll_batch: batch, source_time_entry_id: entry.id,
                                 status: status, origin_reason: origin_reason, resolved_at: status == "superseded" ? Time.current : nil)
          returned_case.payroll_settlement_case_events.create!(
            event_id: SecureRandom.uuid, event_type: status == "superseded" ? "superseded" : "opened",
            to_status: status, occurred_at: Time.current, metadata: { payment_attestation_id: attestation.id + 1 }
          )
          returned_case
        end
        recorder.retract!(attestation: attestation, reason: reason)
        expect(returned_case.reload).to have_attributes(status: status, origin_reason: origin_reason)
        expect(returned_case.payroll_settlement_case_events.count).to eq(1)
      end
    end
  end

  it "does not reopen unrelated closed cases or duplicate an already active successor" do
    origin, _old_target, _target, entry, settlement_case = held_case_fixture
    attestation = recorder.attest!(entry: entry, source_user_uuid: employee.payroll_integration_uuid,
                                  reason: "Owner reported payment; supporting evidence is pending administrator review")
    unrelated = create(:payroll_settlement_case, source_time_entry_id: entry.id, origin_reason: "changed_after_cutoff",
                       status: "superseded", resolved_at: Time.current)
    unrelated.payroll_settlement_case_events.create!(
      event_id: SecureRandom.uuid, event_type: "superseded", from_status: "open", to_status: "superseded",
      occurred_at: Time.current, metadata: { payment_attestation_id: attestation.id + 1 }
    )
    settled = create(:payroll_settlement_case, origin_payroll_batch: unrelated.origin_payroll_batch,
                     source_time_entry_id: entry.id, status: "settled",
                     destination_kind: "supplemental", target_external_pay_period_id: "verified-supplemental", resolved_at: Time.current)
    successor = create(:payroll_settlement_case, origin_payroll_batch: origin.payroll_batch,
                       source_time_entry_id: entry.id, source_time_entry_version: entry.lock_version + 1,
                       origin_reason: "changed_after_cutoff")

    recorder.retract!(attestation: attestation, reason: reason)

    expect(settlement_case.reload.status).to eq("superseded")
    expect(unrelated.reload.status).to eq("superseded")
    expect(settled.reload.status).to eq("settled")
    expect(successor.reload.status).to eq("open")
    expect(PayrollSettlementCase.active.where(origin_payroll_batch: origin.payroll_batch, source_time_entry_id: entry.id).count).to eq(1)
  end

  it "keeps a voided committed manual case available for explicit future routing" do
    _origin, _old_target, target, entry, settlement_case = held_case_fixture
    manual = Payroll::ManualAllocationRecorder.new(actor: actor)
    allocation = manual.commit!(entry: entry, source_user_uuid: employee.payroll_integration_uuid,
                                regular_hours: 8, overtime_hours: 0, external_pay_period_id: "supplemental-void",
                                external_payroll_item_id: "synthetic-void-item", pay_date: target.pay_date.iso8601,
                                reason: "Committed hours to the exact synthetic supplemental payroll item")
    expect(settlement_case.reload.destination_kind).to eq("supplemental")
    manual.void!(allocation: allocation, occurred_at: Time.current.iso8601,
                 reason: "Unissued supplemental check was voided before any delivery")
    expect(settlement_case.reload.status).to eq("scheduled")
    expect(preview(target).fetch(:rows)).to be_empty

    route(settlement_case, target)
    expect(preview(target).dig(:summary, :total_hours)).to eq(8.0)
    expect(PayrollEntryProcessingEvent.count).to eq(0)
  end
end
