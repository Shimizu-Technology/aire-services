# frozen_string_literal: true

require "rails_helper"

RSpec.describe Payroll::TimeEntryRevisionLedger do
  let(:user) do
    create(
      :user,
      role: "employee",
      first_name: "Original",
      last_name: "Employee",
      email: "original.employee@example.com"
    )
  end
  let(:category) { create(:time_category, key: "service", name: "Service") }

  def create_entry(work_date: Date.new(2026, 9, 5), hours: 8)
    create(
      :time_entry,
      user: user,
      time_category: category,
      work_date: work_date,
      hours: hours,
      entry_method: "clock",
      status: "completed",
      approval_status: nil
    )
  end

  it "refuses to reconstruct a cutoff before a legacy entry's first captured revision" do
    entry = create_entry
    revision = PayrollTimeEntryRevision.where(source_time_entry_id: entry.id).order(:id).first
    entry.update_columns(created_at: revision.recorded_at - 2.days)
    # Model a migration snapshot of a source row that already existed; retain
    # its real capture time rather than manufacturing a pre-cutoff revision.
    legacy_id = entry.id + 1_000_000
    PayrollTimeEntryRevision.create!(
      source_time_entry_id: legacy_id, source_version: 0,
      source_user_id: user.id, source_work_date: entry.work_date,
      recorded_at: revision.recorded_at,
      snapshot: revision.snapshot.deep_merge("time_entry" => {
        "id" => legacy_id, "created_at" => (revision.recorded_at - 2.days).iso8601(6)
      })
    )

    expect do
      described_class.new(cutoff_at: revision.recorded_at - 1.day).require_coverage!
    end.to raise_error(described_class::CoverageError, /Revision history does not cover/)
  end

  it "returns the employee, category, and payable values recorded at the cutoff" do
    entry = create_entry
    first_revision = PayrollTimeEntryRevision.where(source_time_entry_id: entry.id).order(:id).last
    cutoff = first_revision.recorded_at

    entry.update_columns(hours: 12, time_category_id: nil, updated_at: Time.current)
    user.update!(first_name: "Renamed")
    category.update!(name: "Renamed category")

    state = described_class.new(cutoff_at: cutoff).entries_for_ids([ entry.id ]).sole

    expect(state).to have_attributes(id: entry.id, hours: 8, time_category_id: category.id)
    expect(state.user.full_name).to eq("Original Employee")
    expect(state.time_category.name).to eq("Service")
  end

  it "keeps a pre-cutoff entry after the mutable source row is deleted" do
    entry = create_entry
    cutoff = PayrollTimeEntryRevision.where(source_time_entry_id: entry.id).order(:id).last.recorded_at

    entry.destroy!

    state = described_class.new(cutoff_at: cutoff).entries_in_range(Date.new(2026, 9, 1)..Date.new(2026, 9, 15)).sole
    expect(state).to have_attributes(id: entry.id, hours: 8)
  end

  it "retains the first state of an entry created and deleted after the cutoff" do
    anchor = create_entry
    cutoff = PayrollTimeEntryRevision.where(source_time_entry_id: anchor.id).order(:id).last.recorded_at
    late = create_entry(work_date: Date.new(2026, 9, 6), hours: 4)
    late.update_columns(created_at: cutoff + 1.minute, updated_at: cutoff + 1.minute)
    late.update_columns(hours: 12, updated_at: cutoff + 2.minutes)
    late.destroy!

    states = described_class.new(cutoff_at: cutoff)
      .entries_created_after_cutoff_in_range(Date.new(2026, 9, 1)..Date.new(2026, 9, 15))

    expect(states.map(&:id)).to eq([ late.id ])
    expect(states.sole).to have_attributes(hours: 12)
    expect(states.sole.created_at).to be > cutoff
  end

  it "uses the latest pre-cutoff location without resurrecting an older in-range revision" do
    entry = create_entry
    entry.update_columns(work_date: Date.new(2026, 9, 20), updated_at: Time.current)
    cutoff = PayrollTimeEntryRevision.where(source_time_entry_id: entry.id).order(:id).last.recorded_at

    ledger = described_class.new(cutoff_at: cutoff)

    expect(ledger.entries_in_range(Date.new(2026, 9, 1)..Date.new(2026, 9, 15))).to be_empty
    expect(ledger.entries_in_range(Date.new(2026, 9, 16)..Date.new(2026, 9, 30)).map(&:id)).to eq([ entry.id ])
  end

  it "keeps the revision ledger append only in PostgreSQL" do
    entry = create_entry
    revision = PayrollTimeEntryRevision.where(source_time_entry_id: entry.id).order(:id).last

    expect do
      PayrollTimeEntryRevision.transaction(requires_new: true) do
        PayrollTimeEntryRevision.where(id: revision.id).update_all(source_work_date: revision.source_work_date + 1.day)
      end
    end.to raise_error(ActiveRecord::StatementInvalid, /append-only/)
  end
end
