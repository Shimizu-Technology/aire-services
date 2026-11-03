# frozen_string_literal: true

require "rails_helper"

RSpec.describe Payroll::HistoryEntryEvidence do
  def legacy_row(entry, snapshot:, owner: entry.user)
    batch = create(:payroll_batch)
    batch.payroll_batch_entries.create!(source_time_entry_id: entry.id, source_user_id: owner.id,
      source_kind: "current", line_key: "legacy", work_date: entry.work_date,
      week_start: entry.work_date.beginning_of_week(:sunday), total_hours: entry.hours,
      regular_hours: entry.hours, overtime_hours: 0, snapshot: snapshot)
  end

  it "does not use an earlier retained revision to establish the missing paid version" do
    entry = create(:time_entry, status: "completed", entry_method: "manual", approval_status: "approved")
    earlier = PayrollTimeEntryRevision.where(source_time_entry_id: entry.id).order(:source_version).last!
    paid_version = earlier.source_version + 2
    entry.update_column(:lock_version, paid_version)
    legacy_row(entry, snapshot: { "version" => paid_version, "user_id" => entry.user_id, "hours" => entry.hours.to_f })
    line = described_class.new(entries: [ entry ]).call.fetch(entry.id).fetch(:baseline_lines).sole
    expect(line).to include(source_time_entry_version: paid_version, current_content_matches: false)
  end

  it "does not use a same-version chronology observation captured after the historical cutoff" do
    entry = create(:time_entry, status: "completed", entry_method: "manual", approval_status: "approved")
    revision = PayrollTimeEntryRevision.where(source_time_entry_id: entry.id).order(:source_version).last!
    row = legacy_row(entry, snapshot: { "version" => revision.source_version, "user_id" => entry.user_id, "hours" => entry.hours.to_f })
    expect(revision.recorded_at).to be > row.payroll_batch.cutoff_at
    line = described_class.new(entries: [ entry ]).call.fetch(entry.id).fetch(:baseline_lines).sole
    expect(line[:current_content_matches]).to be(false)
  end

  it "returns a null legacy UUID after reassignment rather than a boolean or the new owner" do
    entry = create(:time_entry, status: "completed", entry_method: "manual", approval_status: "approved")
    owner = entry.user
    legacy_row(entry, snapshot: { "user_id" => owner.id, "hours" => entry.hours.to_f }, owner: owner)
    entry.update_columns(user_id: create(:user, :employee).id)
    line = described_class.new(entries: [ entry.reload ]).call.fetch(entry.id).fetch(:baseline_lines).sole
    expect(line[:source_user_uuid]).to be_nil
    expect(line[:current_content_matches]).to be(false)
  end

  it "keeps evidence query growth bounded when exporting more held entries" do
    employee = create(:user, :employee)
    admin = create(:user, :admin)
    records = 8.times.map do
      entry = create(:time_entry, user: employee, status: "completed", entry_method: "manual", approval_status: "approved")
      PayrollPaymentAttestation.create!(time_entry: entry, user: employee, recorded_by: admin,
        source_user_uuid: employee.payroll_integration_uuid, source_time_entry_version: entry.lock_version,
        work_date: entry.work_date, hours: entry.hours, reason: "Synthetic reviewed reported-payment evidence hold",
        attested_at: Time.current, status: "pending_evidence")
      entry
    end
    measure = lambda do |subset|
      queries = []
      subscriber = ->(*args) do
        payload = args.last
        queries << payload[:sql] unless payload[:cached] || payload[:name].in?(%w[SCHEMA TRANSACTION])
      end
      result = nil
      ActiveSupport::Notifications.subscribed(subscriber, "sql.active_record") do
        entries = TimeEntry.where(id: subset.map(&:id)).includes(:user, :time_entry_breaks).order(:id).to_a
        result = described_class.new(entries: entries).call
      end
      expect(result.values).to all(include(payment_attestation: include(source_changed: false)))
      queries.length
    end
    measure.call(records.first(1)) # Warm model/schema metadata, not source evidence.
    small = measure.call(records.first(4))
    large = measure.call(records)
    expect(large).to be <= small + 1
  end

  describe "payable segments" do
    let(:guam) { ActiveSupport::TimeZone["Pacific/Guam"] }

    def shift(date, from_hour, to_hour, hours:, break_from: nil, break_to: nil)
      day = Date.iso8601(date)
      start = guam.local(day.year, day.month, day.day, *from_hour)
      finish = guam.local(day.year, day.month, day.day, *to_hour)
      finish += 1.day if finish <= start
      entry = create(:time_entry, work_date: day, status: "completed", entry_method: "clock", approval_status: "approved")
      entry.update_columns(start_time: start, end_time: finish, hours: hours, break_minutes: 0)
      if break_from
        TimeEntryBreak.create!(time_entry: entry, start_time: start.change(hour: break_from), end_time: start.change(hour: break_from) + (break_to - break_from).hours)
        entry.update_columns(break_minutes: (break_to - break_from) * 60)
      end
      TimeEntry.includes(:user, :time_entry_breaks).find(entry.id)
    end

    def segments(entry)
      described_class.new(entries: [ entry ]).call.fetch(entry.id).fetch(:payable_segments)
    end

    it "exports a same-day entry as one segment at its nominal date" do
      expect(segments(shift("2026-09-12", 9, 17, hours: 8))).to eq([ { work_date: "2026-09-12", total_hours: "8.0" } ])
    end

    it "splits a Saturday overnight shift at Sunday midnight Guam" do
      entry = shift("2026-09-12", 22, 2, hours: 4)
      expect(segments(entry)).to eq([ { work_date: "2026-09-12", total_hours: "2.0" }, { work_date: "2026-09-13", total_hours: "2.0" } ])
      expect(entry.work_date).to eq(Date.new(2026, 9, 12))
    end

    it "dates a split shift's post-break segment on the next day and excludes the break" do
      entry = shift("2026-09-15", 20, 3, hours: 6, break_from: 23, break_to: 24)
      expect(segments(entry)).to eq([ { work_date: "2026-09-15", total_hours: "3.0" }, { work_date: "2026-09-16", total_hours: "3.0" } ])
    end

    it "uses the batch builder's cumulative rounding so segment totals equal the entry" do
      entry = shift("2026-09-12", [ 21, 40 ], 1, hours: 3.33)
      exported = segments(entry)
      expect(exported).to eq([ { work_date: "2026-09-12", total_hours: "2.33" }, { work_date: "2026-09-13", total_hours: "1.0" } ])
      allocated = Payroll::PayableIntervals.allocate([ entry ]).fetch(entry.id).fetch(:segments)
      expect(exported.map { |row| BigDecimal(row[:total_hours]) }).to eq(allocated.map { |row| BigDecimal(row[:total_hours].to_s) })
      expect(exported.sum { |row| BigDecimal(row[:total_hours]) }).to eq(entry.hours)
    end

    it "keeps a held overnight interval at its nominal date for review" do
      entry = shift("2026-09-12", 22, 2, hours: 3.5)
      entry.update_columns(break_minutes: 30)
      expect(segments(TimeEntry.includes(:user, :time_entry_breaks).find(entry.id))).to eq([ { work_date: "2026-09-12", total_hours: "3.5" } ])
    end
  end
end
