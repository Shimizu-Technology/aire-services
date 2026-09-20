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
                    occurred_at: "2026-09-17T15:00:00+10:00", reason: "Chelsea confirmed physical check delivery")

    lifecycle = Payroll::EntryLifecycleResolver.new(entries: [ entry ]).call.fetch(entry.id)
    expect(lifecycle.fetch(:status)).to eq("payment_issued")
    expect(lifecycle.fetch(:payment_reference)).to eq("01045")
    expect(lifecycle.fetch(:manually_paid_hours)).to eq(6.1)
    expect(allocation.payroll_manual_allocation_events.pluck(:event_type)).to eq(%w[committed issued])
  end

  it "refuses to over-allocate hours across two payroll items" do
    commit_hours

    expect { commit_hours(payroll_item_id: "1439") }
      .to raise_error(described_class::Error, /exceed the AIRE regular or overtime hours/)
    expect(PayrollManualAllocation.count).to eq(1)
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

    preview = Payroll::BatchBuilder.new(
      start_date: "2026-08-01", end_date: "2026-08-15", cutoff_at: Time.zone.parse("2026-09-19 17:00")
    ).call.fetch(:payload)
    expect(preview.fetch(:summary).fetch(:total_hours)).to eq(6.1)
    expect(Payroll::EntryLifecycleResolver.new(entries: [ entry ]).call.dig(entry.id, :status)).to eq("payment_voided")
  end

  it "does not reoffer delivered hours merely because someone voids their payroll link" do
    allocation = commit_hours
    recorder.issue!(allocation: allocation, payment_method: "paper_check", payment_reference: "01045",
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
end
