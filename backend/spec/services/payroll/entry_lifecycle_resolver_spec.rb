# frozen_string_literal: true

require "rails_helper"

RSpec.describe Payroll::EntryLifecycleResolver do
  it "reports paid and outstanding hours from exact payable-line receipts" do
    entry = create(
      :time_entry,
      status: "completed",
      entry_method: "clock",
      clock_source: "legacy",
      approval_status: nil,
      overtime_status: "none"
    )
    batch = create(:payroll_batch)
    common = {
      source_time_entry_id: entry.id,
      source_user_id: entry.user_id,
      source_user_uuid: entry.user.payroll_integration_uuid,
      source_category_id: entry.time_category_id,
      work_date: entry.work_date,
      week_start: entry.work_date.beginning_of_week(:sunday),
      source_kind: "current",
      snapshot: {}
    }
    paid_line = batch.payroll_batch_entries.create!(
      **common,
      line_key: "operations",
      total_hours: 6,
      regular_hours: 6,
      overtime_hours: 0
    )
    pending_line = batch.payroll_batch_entries.create!(
      **common,
      line_key: "training",
      total_hours: 2,
      regular_hours: 2,
      overtime_hours: 0
    )
    create_event(batch, paid_line, status: "payment_issued", event_id: "paid-operations")
    create_event(batch, pending_line, status: "committed", event_id: "committed-training")

    lifecycle = described_class.new(entries: [ entry ]).call.fetch(entry.id)
    settlement = lifecycle.fetch(:settlements).first

    expect(lifecycle).to include(status: "partially_paid", label: "Partially paid")
    expect(settlement).to include(
      status: "partially_paid",
      total_hours: 8.0,
      paid_hours: 6.0,
      outstanding_hours: 2.0
    )
    expect(settlement.fetch(:payable_lines).map { |line| [ line[:source_line_key], line[:status] ] }).to contain_exactly(
      [ "operations", "payment_issued" ],
      [ "training", "committed" ]
    )
  end

  it "keeps a mixed voided settlement in the attention state" do
    entry = create(
      :time_entry,
      status: "completed",
      entry_method: "clock",
      clock_source: "legacy",
      approval_status: nil,
      overtime_status: "none"
    )
    batch = create(:payroll_batch)
    common = {
      source_time_entry_id: entry.id,
      source_user_id: entry.user_id,
      source_user_uuid: entry.user.payroll_integration_uuid,
      source_category_id: entry.time_category_id,
      work_date: entry.work_date,
      week_start: entry.work_date.beginning_of_week(:sunday),
      source_kind: "current",
      snapshot: {}
    }
    voided_line = batch.payroll_batch_entries.create!(
      **common,
      line_key: "operations",
      total_hours: 6,
      regular_hours: 6,
      overtime_hours: 0
    )
    pending_line = batch.payroll_batch_entries.create!(
      **common,
      line_key: "training",
      total_hours: 2,
      regular_hours: 2,
      overtime_hours: 0
    )
    create_event(batch, voided_line, status: "payment_voided", event_id: "voided-operations")
    create_event(batch, pending_line, status: "committed", event_id: "committed-training")

    lifecycle = described_class.new(entries: [ entry ]).call.fetch(entry.id)
    settlement = lifecycle.fetch(:settlements).first

    expect(lifecycle).to include(status: "payment_voided", label: "Payment voided")
    expect(settlement).to include(
      status: "payment_voided",
      voided_hours: 6.0,
      outstanding_hours: 8.0
    )
  end

  def create_event(batch, row, status:, event_id:)
    PayrollEntryProcessingEvent.create!(
      payroll_batch: batch,
      event_id: event_id,
      source_time_entry_id: row.source_time_entry_id,
      source_user_uuid: row.source_user_uuid,
      contract_version: "2.0",
      source_line_key: row.line_key,
      source_kind: row.source_kind,
      total_hours: row.total_hours,
      regular_hours: row.regular_hours,
      overtime_hours: row.overtime_hours,
      status: status,
      external_system: "cornerstone_payroll",
      occurred_at: Time.current
    )
  end
end
