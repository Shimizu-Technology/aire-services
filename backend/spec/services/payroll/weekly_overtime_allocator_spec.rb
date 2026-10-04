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

  it "keeps long days and multiple same-day entries regular below forty weekly hours" do
    date = Date.new(2026, 9, 14)
    allocations = described_class.call([
      entry(id: 1, date: date, hour: 8, hours: 8),
      entry(id: 2, date: date, hour: 16, hours: 6)
    ])
    expect(allocations.fetch(1)).to include(regular_hours: 8.0, overtime_hours: 0.0)
    expect(allocations.fetch(2)).to include(regular_hours: 6.0, overtime_hours: 0.0)
  end

  it "allocates only the portion beyond forty and resets on Sunday" do
    sunday = Date.new(2026, 9, 13)
    entries = 4.times.map { |i| entry(id: i + 1, date: sunday + i, hour: 8, hours: 10) }
    entries << entry(id: 5, date: sunday + 6, hour: 8, hours: 0.25)
    entries << entry(id: 6, date: sunday + 7, hour: 8, hours: 12)
    allocations = described_class.call(entries.reverse)
    expect(allocations.fetch(4)).to include(regular_hours: 10.0, overtime_hours: 0.0)
    expect(allocations.fetch(5)).to include(regular_hours: 0.0, overtime_hours: 0.25)
    expect(allocations.fetch(6)).to include(regular_hours: 12.0, overtime_hours: 0.0)
  end

  it "does not let review-alert settings change payable overtime or frozen policy" do
    Setting.set("overtime_daily_threshold_hours", "6")
    Setting.set("overtime_weekly_threshold_hours", "10")
    date = Date.new(2026, 9, 14)
    allocation = described_class.call([ entry(id: 1, date: date, hour: 8, hours: 14) ]).fetch(1)
    expect(allocation).to include(regular_hours: 14.0, overtime_hours: 0.0)
    expect(described_class.configured_policy).to eq(
      schema_version: "2.0", calculation: "weekly_only", weekly_threshold_hours: 40.0,
      workweek_start: "sunday", time_zone: "Pacific/Guam"
    )
  end

  it "uses decimal accumulation at the forty-hour boundary" do
    date = Date.new(2026, 9, 14)
    allocations = described_class.call([
      entry(id: 1, date: date, hour: 0, hours: 19.99),
      entry(id: 2, date: date + 1, hour: 0, hours: 20.01),
      entry(id: 3, date: date + 2, hour: 0, hours: 0.01)
    ])
    expect(allocations.fetch(2)).to include(regular_hours: 20.01, overtime_hours: 0.0)
    expect(allocations.fetch(3)).to include(regular_hours: 0.0, overtime_hours: 0.01)
  end
end
