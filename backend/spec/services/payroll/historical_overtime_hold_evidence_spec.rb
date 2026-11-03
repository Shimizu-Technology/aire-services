# frozen_string_literal: true

require "rails_helper"

RSpec.describe Payroll::HistoricalOvertimeHoldEvidence do
  let(:admin) { create(:user, :admin) }
  let(:employee) { create(:user, :employee) }
  let(:category) { create(:time_category) }

  def source(day, hours)
    start = Time.find_zone!("Pacific/Guam").local(2026, 9, day, 8)
    entry = create(:time_entry, user: employee, time_category: category, work_date: start.to_date,
      status: "completed", entry_method: "manual", approval_status: "approved", approved_at: start + hours.hours,
      start_time: start, end_time: start + hours.hours, hours: hours, overtime_status: "none", created_at: start)
    entry.update_columns(updated_at: start + hours.hours)
    entry.reload
  end

  def freeze_history
    Payroll::BatchFinalizer.new(start_date: "2026-09-01", end_date: "2026-09-15", actor: admin,
      manual_processing: true, cutoff_at: "2026-09-20T00:00:00Z", processed_at: "2026-09-20T01:00:00Z",
      external_pay_period_id: "76", processing_note: "Synthetic frozen manual regular hours with unpaid overtime hold").call
  end

  it "accounts for represented regular hours plus unpaid pending overtime without changing approval or payment" do
    (6..9).each { |day| source(day, 8) }
    target = source(10, 10)
    approval = target.overtime_status
    freeze_history
    expect(described_class.new(entries: [ target ]).call(target)).to include(
      kind: "pending_overtime", represented_regular_hours: "8.0",
      frozen_exclusion: include("held_total_hours" => 2.0, "held_overtime_hours" => 2.0))
    expect(target.reload.overtime_status).to eq(approval)
    expect(PayrollManualAllocation.count).to eq(0)
    expect(PayrollPaymentAttestation.count).to eq(0)
    target.update_columns(overtime_status: "approved")
    expect(described_class.new(entries: [ target ]).call(target.reload)).to be_nil
  end

  it "accounts for a wholly unpaid overtime hold with no baseline lines" do
    (6..10).each { |day| source(day, 8) }
    target = source(11, 2)
    freeze_history
    expect(PayrollBatchEntry.where(source_time_entry_id: target.id)).not_to exist
    expect(described_class.new(entries: [ target ]).call(target)).to include(represented_regular_hours: "0.0")
    target.update_columns(hours: 3)
    expect(described_class.new(entries: [ target ]).call(target.reload)).to be_nil
  end

  it "rejects missing or duplicate frozen exclusions, checksum drift and mismatched owners" do
    (6..9).each { |day| source(day, 8) }
    target = source(10, 10)
    batch = freeze_history
    hold = batch.payroll_batch_exclusions.find_by!(source_time_entry_id: target.id)
    expect(described_class.new(entries: [ target ], exclusions: []).call(target)).to be_nil
    expect(described_class.new(entries: [ target ], exclusions: [ hold, hold ]).call(target)).to be_nil
    allow(hold).to receive(:source_user_uuid).and_return(SecureRandom.uuid)
    expect(described_class.new(entries: [ target ], exclusions: [ hold ]).call(target)).to be_nil
    allow(hold).to receive(:source_user_uuid).and_return(employee.payroll_integration_uuid)
    allow(hold).to receive(:payroll_batch).and_return(batch)
    allow(batch).to receive(:checksum).and_return("0" * 64)
    expect(described_class.new(entries: [ target ], exclusions: [ hold ]).call(target)).to be_nil
  end
end
