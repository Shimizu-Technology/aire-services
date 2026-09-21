# frozen_string_literal: true

require "rails_helper"

RSpec.describe Payroll::BatchBuilder do
  let(:builder) { described_class.new(start_date: "2026-08-16", end_date: "2026-08-31") }
  let(:user) { create(:user, :employee) }
  let(:category) { create(:time_category) }
  let(:entry) do
    create(
      :time_entry,
      user: user,
      time_category: category,
      work_date: Date.new(2026, 8, 15),
      hours: 6
    )
  end
  let(:legacy_snapshot) do
    {
      "employee_name" => user.full_name,
      "effective_rate_cents" => 3_500,
      "nested" => { "hourly_rate_cents" => 3_500, "keep" => "audit context" }
    }
  end
  let(:latest) do
    PayrollBatchEntry.new(
      payroll_batch: PayrollBatch.new(cutoff_at: Time.current),
      source_time_entry_id: entry.id,
      source_user_id: user.id,
      source_category_id: category.id,
      work_date: entry.work_date,
      week_start: entry.work_date.beginning_of_week(:sunday),
      total_hours: 8,
      regular_hours: 8,
      overtime_hours: 0,
      source_kind: "current",
      line_key: "category:#{category.id}",
      snapshot: legacy_snapshot
    )
  end

  it "removes legacy compensation fields when copying a correction snapshot" do
    row = builder.send(
      :row_for_prior_dimension,
      entry,
      { total_hours: -2, regular_hours: -2, overtime_hours: 0 },
      latest,
      latest.line_key
    )

    expect(row.fetch(:snapshot)).to include("employee_name" => user.full_name)
    expect(row.dig(:snapshot, "nested")).to eq("keep" => "audit context")
    expect(row.fetch(:snapshot).to_json).not_to match(/(?:effective|hourly)_rate/)
  end

  it "removes legacy compensation fields when copying a deleted-entry snapshot" do
    row = builder.send(:deleted_rows_for, entry.id, [ latest ]).first

    expect(row.fetch(:snapshot)).to include("deleted_after_prior_batch" => true)
    expect(row.fetch(:snapshot).to_json).not_to match(/(?:effective|hourly)_rate/)
  end

  it "classifies a legacy uncategorized entry when its employee has exactly one active category" do
    user.assigned_time_categories << category
    legacy_entry = create(:time_entry, user: user, time_category: category,
                                       work_date: Date.new(2026, 8, 20),
                                       status: "completed", approval_status: "approved",
                                       approved_at: Time.zone.parse("2026-08-21 09:00"),
                                       created_at: Time.zone.parse("2026-08-20 09:00"),
                                       updated_at: Time.zone.parse("2026-08-21 09:00"))
    legacy_entry.update_columns(time_category_id: nil)
    legacy_entry.reload

    result = described_class.new(start_date: "2026-08-16", end_date: "2026-08-31",
                                 cutoff_at: Time.zone.parse("2026-09-10 09:00")).call
    row = result.fetch(:rows).find { |item| item.fetch(:source_time_entry_id) == legacy_entry.id }

    expect(row).to include(source_category_id: category.id, line_key: "category:#{category.id}")
    expect(row.dig(:snapshot, "time_category_inferred_from_sole_assignment")).to be(true)
    expect(result.dig(:issues, :missing_category_count)).to eq(0)
    expect(legacy_entry.reload.time_category_id).to be_nil
  end

  it "does not manufacture a category correction when a prior uncategorized entry now infers its sole category" do
    user.assigned_time_categories << category
    legacy_entry = create(:time_entry, user: user, time_category: category,
                                       work_date: Date.new(2026, 8, 15), hours: 6)
    legacy_entry.update_columns(time_category_id: nil)
    prior = PayrollBatchEntry.new(
      payroll_batch: PayrollBatch.new(cutoff_at: Time.zone.parse("2026-09-01 17:00")),
      source_time_entry_id: legacy_entry.id, source_user_id: user.id,
      source_user_uuid: user.payroll_integration_uuid, source_category_id: nil,
      work_date: legacy_entry.work_date, week_start: legacy_entry.work_date.beginning_of_week(:sunday),
      total_hours: 6, regular_hours: 6, overtime_hours: 0,
      source_kind: "current", line_key: "category:none", snapshot: { "time_category" => nil }
    )

    rows = builder.send(
      :settlement_rows_for, legacy_entry.reload,
      { total_hours: 6.to_d, regular_hours: 6.to_d, overtime_hours: 0.to_d }, [ prior ]
    )

    expect(rows).to be_empty
  end

  it "revisits manually paid entries in a week affected by a new entry" do
    paid_entry = create(:time_entry, user: user, time_category: category,
                                     work_date: Date.new(2026, 9, 15),
                                     status: "completed", approval_status: "approved")
    PayrollManualAllocation.create!(
      time_entry: paid_entry, user: user, recorded_by: create(:user, :admin),
      source_user_uuid: user.payroll_integration_uuid,
      source_time_entry_version: paid_entry.lock_version,
      work_date: paid_entry.work_date, pay_date: Date.new(2026, 9, 16),
      time_category_id: category.id, regular_hours: 8, overtime_hours: 0,
      external_pay_period_id: "68", external_payroll_item_id: "1438",
      reason: "Paid on the prior regular payroll"
    )
    new_entry = create(:time_entry, user: user, time_category: category,
                                   work_date: Date.new(2026, 9, 16),
                                   status: "completed", approval_status: "approved")

    week = new_entry.work_date.beginning_of_week(:sunday)
    ids = builder.send(:settlement_entry_ids, [ new_entry ], [], Set.new([ [ user.id, week ] ]))

    expect(ids).to contain_exactly(new_entry.id, paid_entry.id)
  end

  it "exports only the unpaid remainder of a partly allocated entry" do
    current = create(:time_entry, user: user, time_category: category,
                                  work_date: Date.new(2026, 8, 20), hours: 8,
                                  status: "completed", approval_status: "approved")
    PayrollManualAllocation.create!(
      time_entry: current, user: user, recorded_by: create(:user, :admin),
      source_user_uuid: user.payroll_integration_uuid,
      source_time_entry_version: current.lock_version,
      work_date: current.work_date, pay_date: Date.new(2026, 9, 1),
      time_category_id: category.id, regular_hours: 2, overtime_hours: 0,
      external_pay_period_id: "67", external_payroll_item_id: "101",
      reason: "Two hours already paid in Cornerstone"
    )

    result = described_class.new(start_date: "2026-08-16", end_date: "2026-08-31",
                                 cutoff_at: Time.zone.parse("2026-09-30 17:00")).call
    rows = result.fetch(:rows).select { |row| row.fetch(:source_time_entry_id) == current.id }

    expect(rows.sum { |row| row.fetch(:regular_hours) }).to eq(6)
    expect(rows.sum { |row| row.fetch(:overtime_hours) }).to eq(0)
  end

  it "exports a negative correction when paid hours exceed a later source reduction" do
    current = create(:time_entry, user: user, time_category: category,
                                  work_date: Date.new(2026, 8, 20), hours: 8,
                                  status: "completed", approval_status: "approved")
    PayrollManualAllocation.create!(
      time_entry: current, user: user, recorded_by: create(:user, :admin),
      source_user_uuid: user.payroll_integration_uuid,
      source_time_entry_version: current.lock_version,
      work_date: current.work_date, pay_date: Date.new(2026, 9, 1),
      time_category_id: category.id, regular_hours: 8, overtime_hours: 0,
      external_pay_period_id: "67", external_payroll_item_id: "102",
      reason: "Eight hours already paid in Cornerstone"
    )
    current.update!(end_time: ActiveSupport::TimeZone["Pacific/Guam"].local(2000, 1, 1, 15, 0, 0))
    expect(current.reload.hours).to eq(6)

    result = described_class.new(start_date: "2026-08-16", end_date: "2026-08-31",
                                 cutoff_at: Time.zone.parse("2026-09-30 17:00")).call
    rows = result.fetch(:rows).select { |row| row.fetch(:source_time_entry_id) == current.id }

    expect(rows.sum { |row| row.fetch(:regular_hours) }).to eq(-2)
    expect(result.dig(:issues, :negative_adjustment_count)).to eq(1)
  end

  it "revisits an older entry when its payment link is newer than the last batch" do
    older_entry = create(:time_entry, user: user, time_category: category,
                                      work_date: Date.new(2026, 8, 15),
                                      status: "completed", approval_status: "approved")
    older_entry.update_columns(created_at: Time.zone.parse("2026-08-15 09:00"),
                               updated_at: Time.zone.parse("2026-08-16 09:00"))
    PayrollManualAllocation.create!(
      time_entry: older_entry, user: user, recorded_by: create(:user, :admin),
      source_user_uuid: user.payroll_integration_uuid,
      source_time_entry_version: older_entry.lock_version,
      work_date: older_entry.work_date, pay_date: Date.new(2026, 9, 1),
      time_category_id: category.id, regular_hours: 8, overtime_hours: 0,
      external_pay_period_id: "67", external_payroll_item_id: "103",
      reason: "Linked after the previous AIRE batch"
    )
    latest_batch = create(:payroll_batch, cutoff_at: Time.zone.parse("2026-09-18 17:00"))

    seeds, = builder.send(:settlement_seed_entries, latest_batch)

    expect(seeds.map(&:id)).to include(older_entry.id)
  end

  it "revisits an older entry when its payment link is voided after the last batch" do
    older_entry = create(:time_entry, user: user, time_category: category,
                                      work_date: Date.new(2026, 8, 15),
                                      status: "completed", approval_status: "approved")
    allocation = PayrollManualAllocation.create!(
      time_entry: older_entry, user: user, recorded_by: create(:user, :admin),
      source_user_uuid: user.payroll_integration_uuid,
      source_time_entry_version: older_entry.lock_version,
      work_date: older_entry.work_date, pay_date: Date.new(2026, 9, 1),
      time_category_id: category.id, regular_hours: 8, overtime_hours: 0,
      external_pay_period_id: "67", external_payroll_item_id: "104",
      reason: "Previously paid and then voided"
    )
    allocation.update_columns(
      status: "voided", voided_at: Time.zone.parse("2026-09-19 09:00"),
      created_at: Time.zone.parse("2026-09-17 09:00"),
      updated_at: Time.zone.parse("2026-09-19 09:00")
    )
    latest_batch = create(:payroll_batch, cutoff_at: Time.zone.parse("2026-09-18 17:00"))

    seeds, = builder.send(:settlement_seed_entries, latest_batch)

    expect(seeds.map(&:id)).to include(older_entry.id)
  end

  it "does not reinterpret unchanged paid weeks when a separate held entry is reviewed later" do
    paid = create(:time_entry, user: user, time_category: category,
                               work_date: Date.new(2026, 8, 20), status: "completed",
                               approval_status: "approved",
                               approved_at: Time.zone.parse("2026-08-21 09:00"),
                               created_at: Time.zone.parse("2026-08-20 09:00"),
                               updated_at: Time.zone.parse("2026-08-21 09:00"))
    held = create(:time_entry, user: user, time_category: category,
                               work_date: Date.new(2026, 8, 15), status: "completed",
                               approval_status: "approved",
                               approved_at: Time.zone.parse("2026-09-04 09:00"),
                               created_at: Time.zone.parse("2026-08-15 09:00"),
                               updated_at: Time.zone.parse("2026-09-04 09:00"))
    batch = create(:payroll_batch, start_date: Date.new(2026, 8, 16),
                                  end_date: Date.new(2026, 8, 31),
                                  cutoff_at: Time.zone.parse("2026-09-01 17:00"),
                                  finalized_at: Time.zone.parse("2026-09-01 17:00"))
    batch.payroll_batch_entries.create!(source_time_entry_id: paid.id, source_user_id: user.id,
                                        source_category_id: category.id, work_date: paid.work_date,
                                        week_start: paid.work_date.beginning_of_week(:sunday),
                                        total_hours: 8, regular_hours: 8, overtime_hours: 0,
                                        source_kind: "current", line_key: "category:#{category.id}", snapshot: {})
    batch.payroll_batch_exclusions.create!(source_time_entry_id: held.id, source_user_id: user.id,
                                           reason: "approved_after_cutoff", held_total_hours: 8,
                                           held_regular_hours: 8, held_overtime_hours: 0, snapshot: {})

    result = described_class.new(start_date: "2026-08-16", end_date: "2026-08-31",
                                 cutoff_at: Time.zone.parse("2026-09-03 17:00")).call

    expect(result.fetch(:rows)).to be_empty
    expect(result.fetch(:exclusions).map { |row| row.fetch(:source_time_entry_id) }).to contain_exactly(held.id)
    expect(result.dig(:issues, :negative_adjustment_count)).to eq(0)
  end
end
