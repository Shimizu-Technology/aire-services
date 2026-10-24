# frozen_string_literal: true

require "rails_helper"

RSpec.describe BusinessDate do
  include ActiveSupport::Testing::TimeHelpers

  [
    [ Time.utc(2026, 10, 24, 13, 59, 59), Date.new(2026, 10, 24) ],
    [ Time.utc(2026, 10, 24, 14, 30), Date.new(2026, 10, 25) ],
    [ Time.utc(2026, 10, 31, 14, 30), Date.new(2026, 11, 1) ],
    [ Time.utc(2026, 12, 31, 14, 30), Date.new(2027, 1, 1) ]
  ].each do |instant, date|
    it "uses the Guam business date at #{instant.iso8601} without changing the server zone" do
      Time.use_zone("UTC") do
        travel_to(instant) do
          expect(described_class.today).to eq(date)
          expect(Time.zone.name).to eq("UTC")
        end
      end
    end
  end
  it "uses Guam dates for default day/week totals and upcoming schedules on a UTC server" do
    user = create(:user, :employee)
    saturday = create(:time_entry, user: user, work_date: Date.new(2026, 10, 24), end_time: "11:00",
      entry_method: "manual", status: "completed", approval_status: "approved")
    sunday = create(:time_entry, user: user, work_date: Date.new(2026, 10, 25),
      entry_method: "manual", status: "completed", approval_status: "approved")
    shifts = [ saturday.work_date, sunday.work_date ].map do |date|
      Schedule.create!(user: user, work_date: date, start_time: "08:00", end_time: "16:00")
    end
    Time.use_zone("UTC") do
      travel_to(Time.utc(2026, 10, 24, 14, 30)) do
        expect(TimeClockService.hours_today(user)).to eq(sunday.hours.to_f)
        expect(TimeClockService.hours_this_week(user)).to eq(sunday.hours.to_f)
        expect(TimeClockService.hours_today(user, saturday.work_date)).to eq(saturday.hours.to_f)
        expect(Schedule.upcoming).to contain_exactly(shifts.last)
      end
    end
  end
end
