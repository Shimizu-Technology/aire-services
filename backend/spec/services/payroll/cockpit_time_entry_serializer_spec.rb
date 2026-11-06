# frozen_string_literal: true

require "rails_helper"

RSpec.describe Payroll::CockpitTimeEntrySerializer do
  describe "available time categories" do
    it "returns active assigned categories in case-insensitive name and id order" do
      employee = create(:user, :employee)
      first_alpha = create(:time_category, name: "Alpha", key: "alpha-first")
      last_alpha = create(:time_category, name: "alpha", key: "alpha-last")
      beta = create(:time_category, name: "Beta", key: "beta")
      inactive = create(:time_category, name: "Hidden", key: "hidden", is_active: false)
      employee.assigned_time_categories << [ last_alpha, first_alpha, beta, inactive ]
      entry = create(:time_entry, user: employee, time_category: beta)

      categories = described_class.new(entry).as_json.fetch(:available_time_categories)

      expect(categories).to eq([
        { id: first_alpha.id.to_s, key: "alpha-first", name: "Alpha" },
        { id: last_alpha.id.to_s, key: "alpha-last", name: "alpha" },
        { id: beta.id.to_s, key: "beta", name: "Beta" }
      ])
    end

    it "returns an empty category list when an entry has no employee" do
      entry = build_stubbed(:time_entry, user: nil)

      expect(described_class.new(entry).as_json.fetch(:available_time_categories)).to eq([])
    end
  end

  it "exposes all six fractional digits for raw correction punches and detailed break endpoints" do
    zone = ActiveSupport::TimeZone["Pacific/Guam"]
    employee = create(:user, :employee)
    category = create(:time_category)
    entry = create(:time_entry, user: employee, time_category: category, work_date: "2026-11-14",
                   entry_method: "clock", status: "completed",
                   start_time: zone.local(2026, 11, 14, 8, 0, 17.123456r),
                   end_time: zone.local(2026, 11, 14, 17, 0, 43.654321r),
                   clock_in_at: zone.local(2026, 11, 14, 8, 0, 17.123456r),
                   clock_out_at: zone.local(2026, 11, 14, 17, 0, 43.654321r))
    entry.time_entry_breaks.create!(start_time: zone.local(2026, 11, 14, 12, 0, 59.123456r),
                                  end_time: zone.local(2026, 11, 14, 12, 30, 0.654321r))

    payload = described_class.new(entry.reload).as_json

    expect(payload.values_at(:clock_in_at, :clock_out_at)).to eq(
      [ "2026-11-13T22:00:17.123456Z", "2026-11-14T07:00:43.654321Z" ]
    )
    expect(payload.fetch(:breaks).sole).to include(
      start_time: "2026-11-14T02:00:59.123456Z", end_time: "2026-11-14T02:30:00.654321Z"
    )
    expect(payload.values_at(:start_time, :end_time)).to eq([ "8:00 AM", "5:00 PM" ])
  end
end
