# frozen_string_literal: true

require "rails_helper"

RSpec.describe Payroll::WeeklyOvertimeAllocator do
  Entry = Data.define(:id, :work_date, :start_time, :created_at, :hours)
  let(:guam) { ActiveSupport::TimeZone[TimeClockService::BUSINESS_TIMEZONE] }

  def entry(id:, date:, hour:, hours:)
    Entry.new(
      id: id,
      work_date: date,
      start_time: guam.local(date.year, date.month, date.day, hour),
      created_at: guam.local(date.year, date.month, date.day, hour),
      hours: hours
    )
  end

  it "allocates hours above the configured daily threshold as overtime" do
    date = Date.new(2026, 9, 14)

    allocations = described_class.call([
      entry(id: 1, date: date, hour: 8, hours: 8),
      entry(id: 2, date: date, hour: 16, hours: 6)
    ])

    expect(allocations.fetch(1)).to include(regular_hours: 8.0, overtime_hours: 0.0)
    expect(allocations.fetch(2)).to include(
      regular_hours: 0.0,
      overtime_hours: 6.0,
      daily_cumulative_before: 8.0,
      daily_cumulative_after: 14.0
    )
  end

  it "allocates the portion of one entry beyond eight daily hours" do
    date = Date.new(2026, 9, 14)

    allocation = described_class.call([
      entry(id: 1, date: date, hour: 8, hours: 10)
    ]).fetch(1)

    expect(allocation).to include(regular_hours: 8.0, overtime_hours: 2.0)
  end

  it "still allocates hours beyond forty in a workweek as overtime" do
    sunday = Date.new(2026, 9, 13)
    entries = 6.times.map do |offset|
      entry(id: offset + 1, date: sunday + offset.days, hour: 8, hours: 8)
    end

    allocations = described_class.call(entries)

    expect(allocations.fetch(5)).to include(regular_hours: 8.0, overtime_hours: 0.0)
    expect(allocations.fetch(6)).to include(regular_hours: 0.0, overtime_hours: 8.0)
  end

  it "uses configured daily and weekly thresholds without counting an hour twice" do
    sunday = Date.new(2026, 9, 13)
    entries = [
      entry(id: 1, date: sunday, hour: 8, hours: 7),
      entry(id: 2, date: sunday, hour: 15, hours: 3),
      entry(id: 3, date: sunday + 1.day, hour: 8, hours: 5)
    ]

    allocations = described_class.call(entries, daily_threshold: 8, weekly_threshold: 12)

    expect(allocations.fetch(2)).to include(regular_hours: 1.0, overtime_hours: 2.0)
    expect(allocations.fetch(3)).to include(regular_hours: 2.0, overtime_hours: 3.0)
    expect(allocations.values.sum { |row| row.fetch(:regular_hours) }).to eq(10.0)
    expect(allocations.values.sum { |row| row.fetch(:overtime_hours) }).to eq(5.0)
  end

  it "uses overtime thresholds saved in settings when overrides are omitted" do
    sunday = Date.new(2026, 9, 13)
    Setting.set("overtime_daily_threshold_hours", "6")
    Setting.set("overtime_weekly_threshold_hours", "10")

    allocations = described_class.call([
      entry(id: 1, date: sunday, hour: 8, hours: 7),
      entry(id: 2, date: sunday + 1.day, hour: 8, hours: 6)
    ])

    expect(allocations.fetch(1)).to include(regular_hours: 6.0, overtime_hours: 1.0)
    expect(allocations.fetch(2)).to include(regular_hours: 3.0, overtime_hours: 3.0)
  end
end
