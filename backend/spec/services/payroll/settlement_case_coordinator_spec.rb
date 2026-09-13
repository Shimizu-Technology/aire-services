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
end
