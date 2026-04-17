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

  describe "effective rate snapshotting" do
    let(:user) { create(:user, :employee) }
    let(:flight_category) { create(:time_category, hourly_rate_cents: 4200) }
    let(:ground_category) { create(:time_category, hourly_rate_cents: 2800) }

    it "captures the effective rate for completed manual entries" do
      create(:employee_pay_rate, user: user, time_category: flight_category, hourly_rate_cents: 5600)

      entry = create(:time_entry, user: user, time_category: flight_category, entry_method: "manual", status: "completed")

      expect(entry.effective_rate_cents_snapshot).to eq(5600)
      expect(entry.effective_rate_cents).to eq(5600)
      expect(entry.effective_rate).to eq(56.0)
    end

    it "refreshes the snapshot when the completed entry category changes" do
      create(:employee_pay_rate, user: user, time_category: flight_category, hourly_rate_cents: 5600)
      create(:employee_pay_rate, user: user, time_category: ground_category, hourly_rate_cents: 3100)

      entry = create(:time_entry, user: user, time_category: flight_category, entry_method: "manual", status: "completed")
      entry.update!(time_category: ground_category)

      expect(entry.effective_rate_cents_snapshot).to eq(3100)
      expect(entry.effective_rate).to eq(31.0)
    end
  end
end
