# frozen_string_literal: true

require "rails_helper"

RSpec.describe Payroll::ManualAllocationRecorder do
  let(:actor) { create(:user, :admin) }
  let(:employee) { create(:user, :employee) }
  let(:category) { create(:time_category) }
  let(:entry) do
    create(:time_entry, user: employee, time_category: category,
                        work_date: Date.new(2026, 8, 15),
                        entry_method: "manual", status: "completed",
                        approval_status: "approved", approved_at: Time.zone.parse("2026-08-16 10:00"),
                        created_at: Time.zone.parse("2026-08-15 17:00"),
                        updated_at: Time.zone.parse("2026-08-16 10:00"),
                        start_time: Time.utc(2000, 1, 1, 0, 0),
                        end_time: Time.utc(2000, 1, 1, 6, 6))
  end
  let(:recorder) { described_class.new(actor: actor) }

  def commit_hours(payroll_item_id: "1438")
    recorder.commit!(
      entry: entry,
      source_user_uuid: employee.payroll_integration_uuid,
      regular_hours: "6.10",
      overtime_hours: "0.00",
      external_pay_period_id: "68",
      external_payroll_item_id: payroll_item_id,
      pay_date: "2026-09-17",
      reason: "Verified against the issued Cornerstone adjustment check"
    )
  end

  it "keeps manually committed and issued hours out of the next payable preview while preserving the payment trail" do
    allocation = commit_hours

    before_issue = Payroll::BatchBuilder.new(
      start_date: "2026-08-01", end_date: "2026-08-15", cutoff_at: Time.zone.parse("2026-09-18 17:00")
    ).call.fetch(:payload)
    expect(before_issue.fetch(:summary).fetch(:total_hours)).to eq(0.0)
    expect(Payroll::EntryLifecycleResolver.new(entries: [ entry ]).call.dig(entry.id, :status)).to eq("committed")

    recorder.issue!(allocation: allocation, payment_method: "paper_check", payment_reference: "01045",
                    payment_effective_on: "2026-09-16",
                    occurred_at: "2026-09-17T15:00:00+10:00", reason: "Chelsea confirmed physical check delivery")

    expect(allocation.reload.issued_at).to eq(Time.iso8601("2026-09-17T15:00:00+10:00"))
    expect(allocation.payroll_manual_allocation_events.find_by!(event_type: "issued").occurred_at)
      .to eq(allocation.issued_at)
    expect(allocation.payment_effective_on).to eq(Date.new(2026, 9, 16))
    expect(allocation.payroll_manual_allocation_events.find_by!(event_type: "issued").payment_effective_on)
      .to eq(Date.new(2026, 9, 16))

    lifecycle = Payroll::EntryLifecycleResolver.new(entries: [ entry ]).call.fetch(entry.id)
    expect(lifecycle.fetch(:status)).to eq("payment_issued")
    expect(lifecycle.fetch(:payment_reference)).to eq("01045")
    expect(lifecycle.fetch(:payment_effective_on)).to eq("2026-09-16")
    expect(lifecycle.fetch(:settlements).last.fetch(:payment_effective_on)).to eq("2026-09-16")
    expect(lifecycle.fetch(:manually_paid_hours)).to eq(6.1)
    expect(allocation.payroll_manual_allocation_events.pluck(:event_type)).to eq(%w[committed issued])
  end

  it "refuses to over-allocate hours across two payroll items" do
    commit_hours

    expect { commit_hours(payroll_item_id: "1439") }
      .to raise_error(described_class::Error, /exceed the AIRE regular or overtime hours/)
    expect(PayrollManualAllocation.count).to eq(1)
  end

  it "does not invent a payment date when evidence is missing or later than the record" do
    allocation = commit_hours

    expect do
      recorder.issue!(allocation: allocation, payment_method: "paper_check", payment_reference: "01045",
                      payment_effective_on: "", occurred_at: "2026-09-17T15:00:00+10:00",
                      reason: "Check delivery confirmed without a date")
    end.to raise_error(described_class::Error, /Payment date must use YYYY-MM-DD/)
    expect do
      recorder.issue!(allocation: allocation, payment_method: "paper_check", payment_reference: "01045",
                      payment_effective_on: "2026-09-18", occurred_at: "2026-09-17T15:00:00+10:00",
                      reason: "Check delivery confirmed in the future")
    end.to raise_error(described_class::Error, /cannot be after/)
    expect(allocation.reload.status).to eq("committed")
    expect(allocation.payment_effective_on).to be_nil
  end

  it "refuses to link the same AIRE entry to the same payroll item twice" do
    commit_hours

    expect { commit_hours }
      .to raise_error(described_class::Error, /already linked/)
    expect(PayrollManualAllocation.count).to eq(1)
  end

  it "protects payment events from direct database mutation" do
    event = commit_hours.payroll_manual_allocation_events.first

    [
      "UPDATE payroll_manual_allocation_events SET reason = 'rewritten' WHERE id = #{event.id}",
      "DELETE FROM payroll_manual_allocation_events WHERE id = #{event.id}",
      "TRUNCATE payroll_manual_allocation_events"
    ].each do |sql|
      expect do
        ActiveRecord::Base.transaction(requires_new: true) { ActiveRecord::Base.connection.execute(sql) }
      end.to raise_error(ActiveRecord::StatementInvalid, /append-only/)
    end
    expect(event.reload.event_type).to eq("committed")
  end

  it "returns voided manual hours to the payable preview and preserves the void event" do
    allocation = commit_hours
    recorder.void!(allocation: allocation, occurred_at: "2026-09-18T15:00:00+10:00",
                   reason: "The linked Cornerstone check was voided")

    expect(allocation.reload.voided_at).to eq(Time.iso8601("2026-09-18T15:00:00+10:00"))
    expect(allocation.payroll_manual_allocation_events.find_by!(event_type: "voided").occurred_at)
      .to eq(allocation.voided_at)

    preview = Payroll::BatchBuilder.new(
      start_date: "2026-08-01", end_date: "2026-08-15", cutoff_at: Time.zone.parse("2026-09-19 17:00")
    ).call.fetch(:payload)
    expect(preview.fetch(:summary).fetch(:total_hours)).to eq(6.1)
    expect(Payroll::EntryLifecycleResolver.new(entries: [ entry ]).call.dig(entry.id, :status)).to eq("payment_voided")
  end

  it "shows a later paid batch instead of an older voided manual link" do
    allocation = commit_hours
    recorder.void!(allocation: allocation, occurred_at: "2026-09-18T15:00:00+10:00",
                   reason: "The linked Cornerstone check was voided")
    batch = create(:payroll_batch, cutoff_at: Time.zone.parse("2026-09-19 17:00"),
                                  finalized_at: Time.zone.parse("2026-09-19 17:00"))
    batch.payroll_batch_entries.create!(
      source_time_entry_id: entry.id, source_user_id: employee.id,
      source_user_uuid: employee.payroll_integration_uuid,
      source_category_id: category.id, work_date: entry.work_date,
      week_start: entry.work_date.beginning_of_week(:sunday),
      total_hours: 6.1, regular_hours: 6.1, overtime_hours: 0,
      source_kind: "carryover", line_key: "category:#{category.id}", snapshot: {}
    )
    batch.payroll_entry_processing_events.create!(
      event_id: SecureRandom.uuid, source_time_entry_id: entry.id,
      source_user_uuid: employee.payroll_integration_uuid,
      status: "payment_issued", external_system: "cornerstone",
      external_pay_period_id: "69", external_payroll_item_id: "1500",
      payment_method: "paper_check", payment_reference: "01046",
      occurred_at: Time.zone.parse("2026-09-20 09:00")
    )

    lifecycle = Payroll::EntryLifecycleResolver.new(entries: [ entry ]).call.fetch(entry.id)
    expect(lifecycle.fetch(:status)).to eq("payment_issued")
    expect(lifecycle.fetch(:payment_reference)).to eq("01046")
  end

  it "does not reoffer delivered hours merely because someone voids their payroll link" do
    allocation = commit_hours
    recorder.issue!(allocation: allocation, payment_method: "paper_check", payment_reference: "01045",
                    payment_effective_on: "2026-09-17",
                    occurred_at: "2026-09-17T15:00:00+10:00", reason: "Chelsea confirmed physical check delivery")

    expect do
      recorder.void!(allocation: allocation, occurred_at: "2026-09-18T15:00:00+10:00",
                     reason: "Payroll link was removed without proof of nonpayment")
    end.to raise_error(described_class::Error, /Issued hours cannot be returned/)
    expect(allocation.reload.status).to eq("issued")
    expect(allocation.payroll_manual_allocation_events.pluck(:event_type)).to eq(%w[committed issued])
  end

  it "requires the exact permanent AIRE employee identity" do
    expect do
      recorder.commit!(entry: entry, source_user_uuid: SecureRandom.uuid,
                       regular_hours: "6.10", overtime_hours: "0.00",
                       external_pay_period_id: "68", external_payroll_item_id: "1438",
                       pay_date: "2026-09-17",
                       reason: "Verified against the issued Cornerstone adjustment check")
    end.to raise_error(described_class::Error, /identity changed/)
  end

  it "accepts weekly overtime with no separate overtime approval when the batch builder includes it" do
    entry.update_columns(hours: 9.0, overtime_status: "none")
    entry.reload
    preview = Payroll::BatchBuilder.new(
      start_date: "2026-08-01", end_date: "2026-08-15", cutoff_at: Time.zone.parse("2026-09-18 17:00")
    ).call.fetch(:payload)
    adjustment = preview.fetch(:employees).first.fetch(:adjustments).first
    expect(adjustment.fetch(:regular_hours)).to eq(8.0)
    expect(adjustment.fetch(:overtime_hours)).to eq(1.0)

    allocation = recorder.commit!(
      entry: entry, source_user_uuid: employee.payroll_integration_uuid,
      regular_hours: "8.00", overtime_hours: "1.00",
      external_pay_period_id: "68", external_payroll_item_id: "1438",
      pay_date: "2026-09-17", reason: "Exact AIRE weekly overtime on the issued check"
    )
    expect(allocation).to have_attributes(regular_hours: 8, overtime_hours: 1)
  end

  it "preserves an unresolved legacy category when exact paid hours are reconciled" do
    other_category = create(:time_category)
    employee.user_time_categories.create!(time_category: category)
    employee.user_time_categories.create!(time_category: other_category)
    entry.update_columns(time_category_id: nil)
    entry.reload

    allocation = commit_hours

    expect(allocation.time_category_id).to be_nil
    expect(entry.reload.time_category_id).to be_nil
    expect(allocation.regular_hours).to eq(6.1)
    expect(Payroll::BatchBuilder.new(start_date: "2026-08-01", end_date: "2026-08-15").call.fetch(:payload)
      .fetch(:summary).fetch(:total_hours)).to eq(0.0)
  end
end
