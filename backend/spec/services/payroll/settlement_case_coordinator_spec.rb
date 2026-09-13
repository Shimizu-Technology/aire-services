# frozen_string_literal: true

require "rails_helper"

RSpec.describe Payroll::SettlementCaseCoordinator do
  include ActiveSupport::Testing::TimeHelpers

  let(:guam) { ActiveSupport::TimeZone["Pacific/Guam"] }
  let(:employee) { create(:user, :employee, first_name: "Case", last_name: "Worker") }
  let(:category) { create(:time_category, name: "Operations") }

  def calendar_period(start_date:, pay_date:, external_id: SecureRandom.uuid)
    create(
      :payroll_calendar_period,
      external_pay_period_id: external_id,
      start_date: start_date,
      end_date: start_date.day == 1 ? start_date.change(day: 15) : start_date.end_of_month,
      pay_date: pay_date,
      cutoff_at: guam.local(pay_date.year, pay_date.month, pay_date.day, 17) - 7.days,
      next_finalization_attempt_at: guam.local(pay_date.year, pay_date.month, pay_date.day, 17) - 7.days
    )
  end

  def entry(period:, approval_status: "pending", created_at: period.cutoff_at - 1.day)
    create(
      :time_entry,
      user: employee,
      time_category: category,
      work_date: period.start_date + 2.days,
      start_time: guam.local(period.start_date.year, period.start_date.month, period.start_date.day + 2, 8),
      end_time: guam.local(period.start_date.year, period.start_date.month, period.start_date.day + 2, 16),
      entry_method: "manual",
      status: "completed",
      approval_status: approval_status,
      overtime_status: "none",
      created_at: created_at,
      updated_at: created_at
    )
  end

  it "creates a durable case for held time and names the next published regular payroll" do
    origin = calendar_period(start_date: Date.new(2026, 10, 1), pay_date: Date.new(2026, 10, 25), external_id: "regular-oct-1")
    target = calendar_period(start_date: Date.new(2026, 10, 16), pay_date: Date.new(2026, 11, 10), external_id: "regular-oct-2")
    held = entry(period: origin)

    travel_to(origin.cutoff_at + 1.minute) do
      expect(Payroll::ScheduledCutoffFinalizer.new(period_id: origin.id).call.fetch(:status)).to eq("finalized")
    end

    settlement_case = PayrollSettlementCase.find_by!(source_time_entry_id: held.id)
    expect(settlement_case).to have_attributes(
      origin_reason: "pending_approval",
      destination_kind: "regular",
      status: "scheduled",
      target_payroll_calendar_period_id: target.id,
      target_external_pay_period_id: "regular-oct-2",
      action_due_on: target.pay_date
    )
    expect(settlement_case.payroll_settlement_case_events.pluck(:event_type)).to eq(%w[opened routed])

    travel_to(origin.cutoff_at + 2.minutes) do
      TimeClockService.approve_entry(entry: held, approved_by: create(:user, :admin), note: "Verified after cutoff")
    end
    expect(settlement_case.payroll_settlement_case_events.order(:id).pluck(:event_type)).to eq(%w[opened routed approval_changed])
  end

  it "captures time submitted after a finalized cutoff and gives it a named destination" do
    origin = calendar_period(start_date: Date.new(2026, 10, 1), pay_date: Date.new(2026, 10, 25), external_id: "late-origin")
    target = calendar_period(start_date: Date.new(2026, 10, 16), pay_date: Date.new(2026, 11, 10), external_id: "late-target")
    travel_to(origin.cutoff_at + 1.minute) do
      expect(Payroll::ScheduledCutoffFinalizer.new(period_id: origin.id).call.fetch(:status)).to eq("finalized")
    end
    late = entry(period: origin, approval_status: "approved", created_at: origin.cutoff_at + 2.minutes)

    described_class.record_entry!(late)

    settlement_case = PayrollSettlementCase.find_by!(source_time_entry_id: late.id)
    expect(settlement_case).to have_attributes(
      origin_reason: "created_after_cutoff",
      target_payroll_calendar_period_id: target.id,
      status: "scheduled"
    )
  end

  it "skips a failed period that cannot be retried when automatically naming the next payroll" do
    origin = calendar_period(start_date: Date.new(2026, 10, 1), pay_date: Date.new(2026, 10, 25), external_id: "failed-route-origin")
    unavailable = calendar_period(start_date: Date.new(2026, 10, 16), pay_date: Date.new(2026, 11, 10), external_id: "failed-route-target")
    unavailable.update!(status: "failed", next_finalization_attempt_at: nil)
    available = calendar_period(start_date: Date.new(2026, 11, 1), pay_date: Date.new(2026, 11, 25), external_id: "scheduled-route-target")
    held = entry(period: origin)

    travel_to(origin.cutoff_at + 1.minute) do
      Payroll::ScheduledCutoffFinalizer.new(period_id: origin.id).call
    end

    settlement_case = PayrollSettlementCase.find_by!(source_time_entry_id: held.id)
    expect(settlement_case).to have_attributes(
      status: "scheduled",
      target_payroll_calendar_period_id: available.id,
      target_external_pay_period_id: "scheduled-route-target"
    )
  end

  it "preserves the initiating administrator on asynchronously captured case events" do
    origin = calendar_period(start_date: Date.new(2026, 10, 1), pay_date: Date.new(2026, 10, 25), external_id: "actor-origin")
    admin = create(:user, :admin)
    travel_to(origin.cutoff_at + 1.minute) do
      Payroll::ScheduledCutoffFinalizer.new(period_id: origin.id).call
    end
    late = entry(period: origin, approval_status: "approved", created_at: origin.cutoff_at + 2.minutes)

    Current.set(user: nil) do
      PayrollSettlementCaseCaptureJob.perform_now(late.id, nil, admin.id)
    end

    opened = PayrollSettlementCase.find_by!(source_time_entry_id: late.id)
      .payroll_settlement_case_events.find_by!(event_type: "opened")
    expect(opened.actor).to eq(admin)
    expect(opened.actor_payroll_integration_uuid).to eq(admin.payroll_integration_uuid)
  end

  it "captures the paid-hour correction when an included entry becomes unpayable after cutoff" do
    origin = calendar_period(start_date: Date.new(2026, 10, 1), pay_date: Date.new(2026, 10, 25), external_id: "approval-origin")
    target = calendar_period(start_date: Date.new(2026, 10, 16), pay_date: Date.new(2026, 11, 10), external_id: "approval-target")
    paid = entry(period: origin, approval_status: "approved")

    travel_to(origin.cutoff_at + 1.minute) do
      Payroll::ScheduledCutoffFinalizer.new(period_id: origin.id).call
      paid.update!(approval_status: "denied", approved_by: nil, approved_at: nil)
      described_class.record_entry!(paid)
    end

    settlement_case = PayrollSettlementCase.find_by!(source_time_entry_id: paid.id)
    expect(settlement_case).to have_attributes(
      origin_reason: "changed_after_cutoff",
      held_total_hours: 8,
      destination_kind: "regular",
      target_payroll_calendar_period_id: target.id
    )
  end

  it "does not pull a supplemental case into a regular payroll batch" do
    origin = calendar_period(start_date: Date.new(2026, 10, 1), pay_date: Date.new(2026, 10, 25), external_id: "supp-origin")
    target = calendar_period(start_date: Date.new(2026, 10, 16), pay_date: Date.new(2026, 11, 10), external_id: "supp-target")
    held = entry(period: origin)
    travel_to(origin.cutoff_at + 1.minute) do
      Payroll::ScheduledCutoffFinalizer.new(period_id: origin.id).call
    end
    held.update!(approval_status: "approved", approved_by: create(:user, :admin), approved_at: Time.current)
    settlement_case = PayrollSettlementCase.find_by!(source_time_entry_id: held.id)
    Payroll::SettlementCaseRouter.new(
      settlement_case: settlement_case,
      destination_kind: "supplemental",
      target_external_pay_period_id: "supplemental-2026-10-correction",
      action_due_on: target.pay_date - 2.days,
      assigned_to_id: nil,
      reason: "Pay before the next regular payroll",
      actor: create(:user, :admin)
    ).call

    preview = Payroll::BatchBuilder.new(
      start_date: target.start_date,
      end_date: target.end_date,
      cutoff_at: target.cutoff_at,
      calendar_period: target
    ).call

    expect(preview.fetch(:rows).pluck(:source_time_entry_id)).not_to include(held.id)
  end

  it "keeps a named correction path when previously included time is deleted" do
    origin = calendar_period(start_date: Date.new(2026, 10, 1), pay_date: Date.new(2026, 10, 25), external_id: "delete-origin")
    target = calendar_period(start_date: Date.new(2026, 10, 16), pay_date: Date.new(2026, 11, 10), external_id: "delete-target")
    included = entry(period: origin, approval_status: "approved")
    included.update_columns(entry_method: "clock", clock_source: "kiosk")
    travel_to(origin.cutoff_at + 1.minute) do
      Payroll::ScheduledCutoffFinalizer.new(period_id: origin.id).call
      described_class.record_deletion!(included, actor: create(:user, :admin))
      included.destroy!
    end

    settlement_case = PayrollSettlementCase.find_by!(source_time_entry_id: included.id)
    expect(settlement_case).to have_attributes(
      origin_reason: "deleted_after_cutoff",
      held_total_hours: 8,
      destination_kind: "regular",
      target_payroll_calendar_period_id: target.id,
      status: "scheduled"
    )
    expect(settlement_case.source_snapshot).to include("employee_name" => "Case Worker")
  end

  it "supersedes an unassigned correction before creating the deletion case" do
    origin = calendar_period(start_date: Date.new(2026, 10, 1), pay_date: Date.new(2026, 10, 25), external_id: "unassigned-delete-origin")
    included = entry(period: origin, approval_status: "approved")
    included.update_columns(entry_method: "clock", clock_source: "kiosk")

    travel_to(origin.cutoff_at + 1.minute) do
      Payroll::ScheduledCutoffFinalizer.new(period_id: origin.id).call
      included.update!(end_time: included.end_time + 1.hour)
      described_class.record_entry!(included)
      described_class.record_deletion!(included, actor: create(:user, :admin))
    end

    cases = PayrollSettlementCase.where(source_time_entry_id: included.id).order(:id)
    expect(cases.count).to eq(2)
    expect(cases.first).to have_attributes(status: "superseded", destination_kind: "unassigned")
    expect(cases.last).to have_attributes(status: "open", origin_reason: "deleted_after_cutoff", destination_kind: "unassigned")
  end

  it "keeps not-payable settlement cases out of the ready-for-payroll count" do
    origin = calendar_period(start_date: Date.new(2026, 10, 1), pay_date: Date.new(2026, 10, 25), external_id: "not-payable-origin")
    held = entry(period: origin)
    travel_to(origin.cutoff_at + 1.minute) do
      Payroll::ScheduledCutoffFinalizer.new(period_id: origin.id).call
    end
    held.update!(approval_status: "approved", approved_by: create(:user, :admin), approved_at: Time.current)
    settlement_case = PayrollSettlementCase.find_by!(source_time_entry_id: held.id)
    Payroll::SettlementCaseRouter.new(
      settlement_case: settlement_case,
      destination_kind: "not_payable",
      target_external_pay_period_id: nil,
      action_due_on: nil,
      assigned_to_id: nil,
      reason: "Reviewed and determined not payable",
      actor: create(:user, :admin)
    ).call

    queue = Payroll::CarryoverQueue.new.call

    expect(queue.dig(:items, 0, :status)).to eq("not_payable")
    expect(queue.fetch(:summary)).to include(ready_for_next_batch_count: 0, not_payable_count: 1)
  end

  it "reconciles old unmarked periods once while continuing to revisit recent periods" do
    old_batch = create(
      :payroll_batch,
      start_date: Date.new(2025, 1, 1),
      end_date: Date.new(2025, 1, 15),
      cutoff_at: guam.local(2025, 1, 18, 17),
      finalized_at: guam.local(2025, 1, 18, 17)
    )
    old_period = create(
      :payroll_calendar_period,
      start_date: old_batch.start_date,
      end_date: old_batch.end_date,
      pay_date: Date.new(2025, 1, 25),
      cutoff_at: old_batch.cutoff_at,
      status: "finalized",
      payroll_batch: old_batch,
      finalized_at: old_batch.finalized_at,
      next_finalization_attempt_at: nil
    )

    travel_to(guam.local(2026, 10, 1, 9)) do
      described_class.sync_finalized_periods!
      expect(old_period.reload.payroll_settlement_reconciliation).to be_present

      expect(described_class).not_to receive(:record_missing_exclusion_cases!)
        .with(have_attributes(id: old_period.id))
      described_class.sync_finalized_periods!
    end
  end
end
