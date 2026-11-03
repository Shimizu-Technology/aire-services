# frozen_string_literal: true

require "rails_helper"

RSpec.describe Payroll::PriorOvertimePolicyEvidence do
  let(:user) { create(:user, :employee) }
  let(:category) { create(:time_category) }

  def freeze_entries(hours: [ 10 ], start_on: Date.new(2026, 9, 1), legacy: false, **batch_attributes)
    entries = hours.each_with_index.map do |value, index|
      date = start_on + index
      create(:time_entry, user: user, time_category: category, work_date: date, hours: value,
        start_time: Time.zone.local(date.year, date.month, date.day, 8), end_time: Time.zone.local(date.year, date.month, date.day, 8) + value.hours,
        entry_method: "manual", status: "completed", approval_status: "approved",
        skip_overtime_recomputation: true, created_at: date.to_time, updated_at: date.to_time)
    end
    payload = { "schema_version" => "2.0", "employees" => [] }
    batch = create(:payroll_batch, payload: payload, checksum: Payroll::CanonicalPayload.checksum(payload), **batch_attributes)
    entries.each do |entry|
      snapshot = entry.attributes.slice(*Payroll::LegacyFrozenBatchEvidence::SCALAR_FIELDS)
        .merge("time_category" => category.attributes.slice("id", "key", "name"))
      snapshot.merge!("version" => entry.lock_version, "payable_content_checksum" => Payroll::PayableContent.checksum(entry)) unless legacy
      batch.payroll_batch_entries.create!(source_time_entry_id: entry.id, source_user_id: user.id, source_user_uuid: user.payroll_integration_uuid,
        source_kind: "current", line_key: "entry-#{entry.id}", work_date: entry.work_date, week_start: entry.work_date.beginning_of_week(:sunday),
        total_hours: entry.hours, regular_hours: entry.hours, overtime_hours: 0, snapshot: snapshot)
    end
    [ batch, entries ]
  end

  it "exports preserved production daily8/weekly40 semantics and both splits without changing the frozen payload" do
    batch, = freeze_entries(hours: [ 10, 10, 10, 10, 10 ], start_on: Date.new(2026, 9, 6))
    original = batch.payload.deep_dup
    proof = described_class.new(batch: batch).call
    expect(proof).to include("kind" => described_class::KIND, "policy" => described_class::POLICY)
    employee = proof.fetch("employees").sole
    expect(employee).to include("eligible" => true, "blockers" => [])
    expect(employee["allocations"].pluck("regular_hours", "overtime_hours")).to eq([
      [ "8.0", "2.0" ], [ "8.0", "2.0" ], [ "8.0", "2.0" ], [ "8.0", "2.0" ], [ "0.0", "10.0" ]
    ])
    expect(proof["evidence_checksum"]).to eq(Payroll::CanonicalPayload.checksum(proof.except("evidence_checksum")))
    expect(batch.reload.payload).to eq(original)
    expect(Payroll::WeeklyOvertimeAllocator.configured_policy[:calculation]).to eq("weekly_only")
  end

  it "uses frozen prior-period context for a week and resets on Guam Sunday" do
    freeze_entries(hours: [ 20, 20 ], start_on: Date.new(2026, 8, 30), start_date: "2026-08-16", end_date: "2026-08-31")
    batch, = freeze_entries(hours: [ 5 ], start_on: Date.new(2026, 9, 1))
    expect(described_class.new(batch: batch).call["employees"].sole["allocations"].sole).to include("regular_hours" => "0.0", "overtime_hours" => "5.0")
  end

  it "supports unchanged older snapshots without inventing a frozen UUID or version" do
    batch, = freeze_entries(legacy: true)
    expect(described_class.new(batch: batch).call["employees"].sole["eligible"]).to be(true)
  end

  it "refuses changed frozen sources and keeps unfrozen owed sources outside its accounting scope" do
    batch, entries = freeze_entries
    entries.sole.update!(hours: 11)
    expect(described_class.new(batch: batch).call["employees"].sole["blockers"]).to include("frozen_source_changed_or_missing:#{entries.sole.id}")
    create(:time_entry, user: user, time_category: category, hours: 1, work_date: "2026-09-02", status: "completed", approval_status: "approved")
    expect(described_class.new(batch: batch).call["input_scope"]).to eq("all_effective_frozen_current_lines_in_workweek_through_batch_end")
    expect(described_class.new(batch: batch).call["employees"].sole["inputs"].length).to eq(1)
  end

  it "does not export the prior policy for Oct16 or a later connected period" do
    batch, = freeze_entries(start_on: Date.new(2026, 10, 16), start_date: "2026-10-16", end_date: "2026-10-31")
    expect(described_class.new(batch: batch).call).to be_nil
  end

  it "refuses a missing frozen source and a partial represented entry" do
    batch, entries = freeze_entries
    entries.sole.destroy!
    expect(described_class.new(batch: batch).call["employees"].sole["blockers"]).to include("frozen_source_changed_or_missing:#{entries.sole.id}")
    other, = freeze_entries
    # Immutable row corrections are unavailable; simulate malformed retained
    # evidence on this read without modifying the source or frozen database.
    rows = other.payroll_batch_entries.to_a
    allow_any_instance_of(PayrollBatchEntry).to receive(:total_hours).and_return(1.to_d)
    expect(described_class.new(batch: other).call["employees"].sole["blockers"]).to include("partial_or_conflicting_source:#{rows.sole.source_time_entry_id}")
  end

  it "refuses payload tampering and any retained threshold evidence requiring individual review" do
    batch, = freeze_entries
    Setting.create!(key: "overtime_daily_threshold_hours", value: "6", created_at: "2026-04-01", updated_at: "2026-04-01")
    expect(described_class.new(batch: batch).call["employees"].sole["blockers"]).to include("historical_threshold_audit_requires_review")
    allow(batch).to receive(:checksum).and_return("b" * 64)
    expect(described_class.new(batch: batch).call["employees"].sole["blockers"]).to include("immutable_payload_checksum_mismatch")
  end
end
