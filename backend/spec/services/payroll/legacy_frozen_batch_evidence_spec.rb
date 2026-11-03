# frozen_string_literal: true

require "rails_helper"

RSpec.describe Payroll::LegacyFrozenBatchEvidence do
  let(:approved_at) { nil }
  let(:overtime_approved_at) { nil }
  let(:entry) do
    create(:time_entry, status: "completed", entry_method: "manual", approval_status: "approved", work_date: "2026-09-01",
      skip_overtime_recomputation: true, approved_at: approved_at, overtime_approved_at: overtime_approved_at, created_at: Time.utc(2026, 9, 1), updated_at: Time.utc(2026, 9, 2))
  end
  let(:batch) do
    payload = { "schema_version" => "2.0", "employees" => [] }
    create(:payroll_batch, payload: payload, checksum: Payroll::CanonicalPayload.checksum(payload))
  end
  let(:snapshot) do
    entry.attributes.slice(*described_class::SCALAR_FIELDS).merge("time_category" => entry.time_category.attributes.slice("id", "key", "name"))
  end
  let(:row) do
    batch.payroll_batch_entries.create!(source_time_entry_id: entry.id, source_user_id: entry.user_id,
      source_kind: "current", line_key: "legacy", work_date: entry.work_date,
      week_start: entry.work_date.beginning_of_week(:sunday), total_hours: entry.hours,
      regular_hours: entry.hours, overtime_hours: 0, snapshot: snapshot)
  end

  def evidence(source = entry)
    described_class.new(rows: [ row ]).call(row: row, entry: source)
  end

  it "accepts retained snapshot plus unchanged source without inventing a frozen version or UUID" do
    expect(evidence).to include(kind: "legacy_frozen_batch_baseline", eligible: true, blockers: [],
      evidence_strength: "retained_snapshot_and_unchanged_source", source_version: entry.lock_version)
    expect(row.snapshot).not_to have_key("version")
    expect(row.source_user_uuid).to be_nil
  end

  it "allows an honest later backfill observation, but not an observation showing a source edit" do
    row
    expect(evidence).to include(eligible: true)
    entry.update_columns(updated_at: Time.utc(2026, 9, 3), hours: entry.hours + 1)
    entry.update_columns(updated_at: Time.utc(2026, 9, 2), hours: row.total_hours)
    expect(evidence(entry.reload)[:blockers]).to include("revision_shows_later_edit")
  end

  it "rejects a snapshot mismatch" do
    snapshot["hours"] = entry.hours + 1
    expect(evidence[:blockers]).to include("snapshot_mismatch")
  end

  it "rejects any source edit after finalization even if hours still match" do
    row
    entry.update!(description: "Later source edit requires individual review")
    expect(evidence(entry.reload)[:blockers]).to include("source_timestamp_after_finalization")
  end

  it "rejects a missing source" do
    row
    expect(evidence(nil)[:blockers]).to include("source_missing")
  end

  it "rejects a payload checksum mismatch" do
    allow(batch).to receive(:checksum).and_return("b" * 64)
    expect(evidence[:blockers]).to include("batch_payload_checksum_mismatch")
  end

  it "rejects reassigned identity" do
    row
    entry.update_columns(user_id: create(:user, :employee).id)
    expect(evidence(entry.reload)[:blockers]).to include("source_owner_changed")
  end

  it "rejects a retained category mismatch or an empty category claim" do
    snapshot["time_category"]["id"] = entry.time_category_id + 1
    expect(evidence[:blockers]).to include("snapshot_mismatch")
    snapshot["time_category"] = {}
    expect(evidence[:blockers]).to include("snapshot_mismatch")
  end

  it "accepts matching retained punches and empty breaks with normalized timestamp values" do
    snapshot["start_time"] = entry.start_time.iso8601(6)
    snapshot["end_time"] = entry.end_time.iso8601(6)
    snapshot["breaks"] = []
    expect(evidence[:eligible]).to be(true)
  end

  it "rejects a retained punch mismatch" do
    snapshot["end_time"] = (entry.end_time + 1.minute).iso8601(6)
    expect(evidence[:blockers]).to include("snapshot_mismatch")
  end

  it "rejects a retained break mismatch" do
    snapshot["breaks"] = [ { "start_time" => "2026-09-01T03:00:00Z", "end_time" => "2026-09-01T03:15:00Z", "duration_minutes" => 15 } ]
    expect(evidence[:blockers]).to include("snapshot_mismatch")
  end

  %w[approved_at overtime_approved_at].each do |field|
    it "rejects a retained #{field} mismatch" do
      snapshot[field] = "2026-09-02T01:00:00Z"
      expect(evidence[:blockers]).to include("snapshot_mismatch")
    end
  end

  context "with fractional approval timestamps" do
    let(:approved_at) { Time.iso8601("2026-09-02T01:00:00.123456Z") }
    let(:overtime_approved_at) { Time.iso8601("2026-09-02T01:00:01.654321Z") }

    it "compares genuinely serialized whole seconds with the unchanged fractional source" do
      snapshot["approved_at"] = entry.approved_at.iso8601
      snapshot["overtime_approved_at"] = entry.overtime_approved_at.iso8601
      expect(evidence[:eligible]).to be(true)
    end
  end

  it "retains unknown breaks in earlier observations without treating absence as an empty break list" do
    row
    observation = PayrollTimeEntryRevision.where(source_time_entry_id: entry.id).first
    allow(observation).to receive(:snapshot).and_return(observation.snapshot.except("breaks"))
    entry.association(:time_entry_breaks).target = [ TimeEntryBreak.new(start_time: Time.utc(2026, 9, 1, 3),
      end_time: Time.utc(2026, 9, 1, 3, 15), duration_minutes: 15,
      created_at: Time.utc(2026, 9, 1), updated_at: Time.utc(2026, 9, 1)) ]
    entry.association(:time_entry_breaks).loaded!
    service = described_class.new(rows: [ row ])
    service.instance_variable_set(:@revisions, { entry.id => [ observation ] })
    expect(service.call(row: row, entry: entry)).to include(eligible: true, revision_missing_break_chronology_count: 1)
  end

  it "preserves fractional finalization for authenticated legacy reconciliation" do
    allow(batch).to receive(:finalized_at).and_return(Time.iso8601("2026-09-18T07:00:00.123456Z"))
    expect(evidence[:batch_finalized_at]).to eq(batch.export_payload.dig("export", "finalized_at_precise"))
    expect(evidence[:eligible]).to be(true)
  end

  it "rejects a rate override that was not retained in the snapshot" do
    snapshot.delete("effective_rate_cents_snapshot")
    row
    entry.update_columns(effective_rate_cents_snapshot: 1500)
    expect(evidence(entry.reload)[:blockers]).to include("snapshot_mismatch")
  end

  it "rejects a later successful edit audit even when a source timestamp was backdated" do
    row
    AuditLog.record!(action: "time_entry.updated", auditable: entry, changes: { "hours" => [ 8, 9 ] },
      occurred_at: batch.finalized_at + 1.second)
    expect(evidence[:blockers]).to include("audit_shows_later_edit")
  end
end
