# frozen_string_literal: true

require "rails_helper"

RSpec.describe TimeEntry, type: :model do
  describe "time validation" do
    let(:user) { create(:user, :employee) }
    let(:guam_zone) { ActiveSupport::TimeZone[TimeClockService::BUSINESS_TIMEZONE] }

    it "allows completed entries that end after midnight" do
      entry = build(
        :time_entry,
        user: user,
        work_date: Date.new(2026, 4, 2),
        start_time: guam_zone.local(2026, 4, 2, 23, 30, 0),
        end_time: guam_zone.local(2026, 4, 3, 1, 30, 0),
        clock_in_at: guam_zone.local(2026, 4, 2, 23, 30, 0),
        clock_out_at: guam_zone.local(2026, 4, 3, 1, 30, 0),
        entry_method: "clock"
      )

      expect(entry).to be_valid
      expect(entry.hours).to eq(2.0)
    end

    it "still rejects entries with matching start and end wall-clock times" do
      entry = build(
        :time_entry,
        user: user,
        start_time: guam_zone.local(2026, 4, 2, 9, 0, 0),
        end_time: guam_zone.local(2026, 4, 2, 9, 0, 0)
      )

      expect(entry).not_to be_valid
      expect(entry.errors[:end_time]).to include("must be after start time")
    end

    it "rejects same-day entries that end before they start" do
      entry = build(
        :time_entry,
        user: user,
        start_time: guam_zone.local(2026, 4, 2, 9, 0, 0),
        end_time: guam_zone.local(2026, 4, 2, 8, 0, 0)
      )

      expect(entry).not_to be_valid
      expect(entry.errors[:end_time]).to include("must be after start time")
    end
  end

  describe "work category validation" do
    it "requires a category for every completed entry" do
      entry = build(:time_entry, time_category: nil)

      expect(entry).not_to be_valid
      expect(entry.errors[:time_category]).to include("must be selected")
    end

    it "rejects a newly selected inactive category" do
      entry = build(:time_entry, time_category: create(:time_category, is_active: false))

      expect(entry).not_to be_valid
      expect(entry.errors[:time_category]).to include("must be active")
    end
  end

  describe ".countable" do
    it "matches per-entry payroll eligibility for every approval state and entry method" do
      approval_states = [ nil, "pending", "approved", "denied" ]
      entries = %w[clock manual].product(approval_states).map do |entry_method, approval_status|
        create(
          :time_entry,
          entry_method: entry_method,
          clock_source: entry_method == "clock" ? "kiosk" : nil,
          approval_status: approval_status,
          status: "completed"
        )
      end

      countable_ids = described_class.countable.where(id: entries.map(&:id)).pluck(:id)

      entries.each do |entry|
        expect(countable_ids.include?(entry.id)).to eq(entry.counts_toward_hours?),
          "expected scope and instance eligibility to agree for #{entry.entry_method}/#{entry.approval_status.inspect}"
      end
      expect(entries.select(&:counts_toward_hours?).map { |entry| [ entry.entry_method, entry.approval_status ] })
        .to contain_exactly([ "clock", nil ], [ "clock", "approved" ], [ "manual", "approved" ])
    end
  end
end
