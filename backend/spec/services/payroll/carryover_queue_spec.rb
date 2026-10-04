# frozen_string_literal: true

require "rails_helper"

RSpec.describe Payroll::CarryoverQueue do
  include ActiveSupport::Testing::TimeHelpers

  around { |example| travel_to(Time.utc(2026, 10, 1)) { example.run } }

  let(:employee) { create(:user, :employee) }
  let(:category) { create(:time_category) }

  def entry(date:, hours: 9, approval_status: nil, overtime_status: "denied")
    create(:time_entry, user: employee, time_category: category,
                        work_date: date, entry_method: "clock", approval_status: approval_status,
                        overtime_status: overtime_status,
                        start_time: Time.utc(2000, 1, 1, 0), end_time: Time.utc(2000, 1, 1, 0) + hours.hours)
  end

  def exclude(record, reason: "denied_overtime")
    period_start = Date.new(2026, 9, 1).next_month(PayrollBatch.count)
    create(:payroll_batch, start_date: period_start, end_date: period_start.change(day: 15)).payroll_batch_exclusions.create!(
      source_time_entry_id: record.id, source_user_id: employee.id,
      reason: reason, held_total_hours: record.hours,
      held_regular_hours: 0, held_overtime_hours: record.hours, snapshot: {}
    )
  end

  it "resurfaces a daily-only denied exclusion even without an earlier carryover exclusion" do
    target = entry(date: Date.new(2026, 5, 4))
    exclusion = exclude(target)
    result = described_class.new.call
    expect(result.fetch(:items).sole).to include(status: "needs_review", exclusion_reason: "denied_overtime")
    expect(result.fetch(:summary)).to include(ready_for_next_batch_count: 0, needs_review_count: 1, not_payable_count: 0)
    expect(exclusion.reload.reason).to eq("denied_overtime")
    expect(target.reload.overtime_status).to eq("denied")
  end

  def manual_allocation(record, status:, hours:)
    PayrollManualAllocation.create!(
      time_entry: record, user: employee, time_category: category, recorded_by: create(:user, :admin),
      source_user_uuid: employee.payroll_integration_uuid, source_time_entry_version: record.lock_version,
      work_date: record.work_date, pay_date: Date.new(2026, 9, 30),
      external_pay_period_id: "manual-period", external_payroll_item_id: SecureRandom.uuid,
      regular_hours: hours, overtime_hours: 0, status: status, reason: "Verified historical payroll",
      issued_at: status == "issued" ? Time.current : nil,
      payment_effective_on: status == "issued" ? Date.current : nil
    )
  end

  it "shows fully issued manual hours as paid without a later batch or case" do
    target = entry(date: Date.new(2026, 5, 4))
    exclude(target)
    allocation = manual_allocation(target, status: "issued", hours: 9)
    item = described_class.new.call.fetch(:items).sole
    expect(item).to include(status: "payment_issued", included_batch: nil, settlement_case: nil)
    expect(item.fetch(:payroll_lifecycle)).to include(manually_paid_hours: 9.0)
    expect(allocation.reload.status).to eq("issued")
  end

  it "preserves full and partial manual reservations instead of offering the hours again" do
    target = entry(date: Date.new(2026, 5, 4))
    exclude(target)
    allocation = manual_allocation(target, status: "committed", hours: 9)
    expect(described_class.new.call.fetch(:items).sole.fetch(:status)).to eq("committed")
    allocation.update!(regular_hours: 8)
    expect(described_class.new.call.fetch(:items).sole.fetch(:status)).to eq("partially_allocated")
    allocation.update!(status: "issued", issued_at: Time.current, payment_effective_on: Date.current)
    item = described_class.new.call.fetch(:items).sole
    expect(item.fetch(:status)).to eq("partially_paid")
    expect(item.fetch(:payroll_lifecycle)).to include(manually_paid_hours: 8.0)
  end

  it "retains the owner payment evidence hold before historical routing" do
    target = entry(date: Date.new(2026, 5, 4))
    exclude(target)
    PayrollPaymentAttestation.create!(
      time_entry: target, user: employee, recorded_by: create(:user, :admin),
      source_user_uuid: employee.payroll_integration_uuid, source_time_entry_version: target.lock_version,
      work_date: target.work_date, hours: 9, reason: "Owner confirmed printed checks", attested_at: Time.current
    )
    expect(described_class.new.call.fetch(:items).sole.fetch(:status)).to eq("payment_attested_pending_evidence")
  end

  it "requires an explicit destination and then includes only the unpaid regular delta" do
    target = entry(date: Date.new(2026, 5, 4))
    exclusion = exclude(target)
    batch = exclusion.payroll_batch
    origin = create(:payroll_calendar_period, start_date: batch.start_date, end_date: batch.end_date,
                    status: "finalized", payroll_batch: batch, finalized_at: batch.finalized_at)
    original_policy = origin.overtime_policy.deep_dup
    batch.payroll_batch_entries.create!(
      source_time_entry_id: target.id, source_user_id: employee.id,
      source_user_uuid: employee.payroll_integration_uuid, source_category_id: category.id,
      work_date: target.work_date, week_start: target.work_date.beginning_of_week(:sunday),
      source_kind: "current", line_key: "category:#{category.id}",
      total_hours: 8, regular_hours: 8, overtime_hours: 0, snapshot: {}
    )
    future = create(:payroll_calendar_period, start_date: Date.new(2026, 11, 1), end_date: Date.new(2026, 11, 15))
    admin = create(:user, :admin)
    Payroll::SettlementCaseCoordinator.finalize_period!(period: origin, batch: batch, actor: admin)
    settlement_case = PayrollSettlementCase.find_by!(source_time_entry_id: target.id)
    Payroll::SettlementCaseCoordinator.prepare_for_period!(future)
    expect(settlement_case.reload).to have_attributes(status: "open", destination_kind: "unassigned")
    expect(described_class.new.call.fetch(:items).sole.fetch(:status)).to eq("needs_review")
    Payroll::SettlementCaseRouter.new(
      settlement_case: settlement_case, destination_kind: "regular",
      target_external_pay_period_id: future.external_pay_period_id,
      action_due_on: future.pay_date, assigned_to_id: nil,
      reason: "Reviewed previous 8 regular hours; pay remaining 1 regular hour", actor: admin
    ).call
    expect(described_class.new.call.fetch(:items).sole.fetch(:status)).to eq("ready_for_next_batch")
    preview = Payroll::BatchBuilder.new(start_date: future.start_date, end_date: future.end_date,
                                       cutoff_at: future.cutoff_at, calendar_period: future).call
    adjustment = preview.fetch(:rows).sole
    expect(adjustment).to include(total_hours: 1.0, regular_hours: 1.0, overtime_hours: 0.0)
    expect(batch.payroll_batch_entries.sole.reload.regular_hours).to eq(8)
    expect(origin.reload.overtime_policy).to eq(original_policy)
    expect(exclusion.reload.reason).to eq("denied_overtime")
    expect(target.reload.overtime_status).to eq("denied")
  end

  it "continues to hold genuine denied weekly overtime while retaining historical evidence" do
    5.times { |offset| entry(date: Date.new(2026, 5, 3) + offset, hours: 8, overtime_status: "approved") }
    target = entry(date: Date.new(2026, 5, 8), hours: 2)
    exclude(target)
    expect(described_class.new.call.fetch(:items).sole.fetch(:status)).to eq("not_payable")
  end

  it "keeps denied ordinary approval exclusions not payable" do
    target = entry(date: Date.new(2026, 5, 4), approval_status: "denied", overtime_status: "none")
    exclude(target, reason: "pending_approval")
    exclude(target, reason: "denied_approval")
    expect(described_class.new.call.fetch(:items).sole.fetch(:status)).to eq("not_payable")
  end
end
