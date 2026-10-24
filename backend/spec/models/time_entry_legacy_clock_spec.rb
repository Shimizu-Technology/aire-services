# frozen_string_literal: true

require "rails_helper"

RSpec.describe "Legacy approved long clock compatibility", type: :model do
  let(:admin) { create(:user, :admin) }
  let(:start) { Time.iso8601("2026-10-19T22:00:59.123456Z") }
  let(:entry) do
    record = create(:time_entry, entry_method: "clock", work_date: "2026-10-20",
      start_time: start, end_time: start + 2.hours, clock_in_at: start, clock_out_at: start + 2.hours,
      approval_status: "approved", approved_by: admin, approved_at: start)
    record.update_columns(clock_out_at: start + 26.hours, hours: 2)
    record.reload
  end

  def facts
    entry.reload.attributes.slice("start_time", "end_time", "clock_in_at", "clock_out_at", "hours",
      "break_minutes", "approval_status", "approved_by_id", "approved_at")
  end

  [ { overtime_status: "pending" }, { description: "Legacy admin note" },
    { overtime_note: "Receipt reconciliation metadata", effective_rate_cents_snapshot: 2500 } ].each do |attributes|
    it "allows unrelated legacy bookkeeping #{attributes.keys.join(', ')} without changing paid source facts" do
      original = facts
      entry.update!(attributes)
      expect(facts).to eq(original)
    end
  end

  it "allows a model category update without implicitly recalculating historical time" do
    original = facts
    entry.update!(time_category: create(:time_category))
    expect(facts).to eq(original)
  end

  it "does not recalculate unchanged time when an unrelated service explicitly calls the calculator" do
    original = facts
    entry.description = "Unrelated edit"
    entry.calculate_hours_from_times
    entry.save!
    expect(facts).to eq(original)
  end

  it "rejects a new transition into approved for an existing held entry" do
    entry.update_columns(approval_status: "pending")
    entry.reload.approval_status = "approved"
    expect(entry.save).to be(false)
    expect(entry.errors[:approval_status]).to include("needs administrator correction before approval")
    expect(entry.reload.approval_status).to eq("pending")
  end

  it "still holds a legacy row when its actual time fields change" do
    entry.update!(clock_in_at: start + 5.minutes, start_time: start + 5.minutes)
    expect(entry.reload).to have_attributes(hours: 0, approval_status: "pending", approved_by_id: nil)
  end

  it "preserves legacy hours on a Payroll note correction while retaining its explicit review policy" do
    original = facts
    Payroll::TimeEntryCorrection.new(entry: entry, actor: admin, attributes: { description: "Clarified note" }, reason: "Verified note only").call
    expect(facts.except("approval_status", "approved_by_id", "approved_at")).to eq(original.except("approval_status", "approved_by_id", "approved_at"))
    expect(entry.reload.approval_status).to eq("pending")
  end
end
