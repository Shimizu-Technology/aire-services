# frozen_string_literal: true

require "rails_helper"

RSpec.describe Payroll::TimeSummaryBuilder do
  describe "#call" do
    it "does not pool weekly overtime thresholds across employees in summary totals" do
      first_user = create(:user, first_name: "Alex", last_name: "CFI")
      second_user = create(:user, first_name: "Bailey", last_name: "CFI")
      category = create(:time_category, name: "Flight Instruction", key: "aire_flight_instruction")
      zone = ActiveSupport::TimeZone[TimeClockService::BUSINESS_TIMEZONE]

      [ first_user, second_user ].each_with_index do |user, user_index|
        3.times do |day_index|
          create(:time_entry,
            user: user,
            time_category: category,
            work_date: Date.new(2026, 5, 18 + user_index + day_index),
            start_time: zone.local(2000, 1, 1, 0, 0, 0),
            end_time: zone.local(2000, 1, 1, 10, 0, 0))
        end
      end

      payload = described_class.new(start_date: "2026-05-18", end_date: "2026-05-24").call

      expect(payload.dig(:summary, :countable_hours)).to eq(60.0)
      expect(payload.dig(:summary, :regular_hours)).to eq(60.0)
      expect(payload.dig(:summary, :overtime_hours)).to eq(0.0)
      expect(payload.fetch(:employees)).to all(include(regular_hours: 30.0, overtime_hours: 0.0))
    end

    it "exports category-level regular and overtime hours for payroll imports" do
      user = create(:user, first_name: "Carla", last_name: "CFI")
      flight = create(:time_category, name: "Flight Instruction", key: "aire_flight_instruction", hourly_rate_cents: 7_500)
      ground = create(:time_category, name: "Ground School", key: "aire_ground_school", hourly_rate_cents: 4_500)
      zone = ActiveSupport::TimeZone[TimeClockService::BUSINESS_TIMEZONE]

      create(:time_entry,
        user: user,
        time_category: flight,
        work_date: Date.new(2026, 5, 18),
        start_time: zone.local(2000, 1, 1, 0, 0, 0),
        end_time: zone.local(2000, 1, 1, 23, 0, 0))
      create(:time_entry,
        user: user,
        time_category: ground,
        work_date: Date.new(2026, 5, 19),
        start_time: zone.local(2000, 1, 1, 0, 0, 0),
        end_time: zone.local(2000, 1, 1, 20, 0, 0))

      payload = described_class.new(start_date: "2026-05-18", end_date: "2026-05-24").call
      employee = payload.fetch(:employees).first
      ground_day = employee.fetch(:days).find { |day| day.fetch(:work_date) == "2026-05-19" }
      ground_bucket = ground_day.fetch(:categories).find { |category| category.fetch(:key) == "aire_ground_school" }

      expect(employee).to include(
        total_hours: 43.0,
        regular_hours: 40.0,
        overtime_hours: 3.0
      )
      expect(ground_bucket).to include(
        hours: 20.0,
        total_hours: 20.0,
        regular_hours: 17.0,
        overtime_hours: 3.0,
        effective_rate_cents: 4_500
      )
      expect(payload.dig(:summary, :regular_hours)).to eq(40.0)
      expect(payload.dig(:summary, :overtime_hours)).to eq(3.0)
    end
  end
end
