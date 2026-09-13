# frozen_string_literal: true

require "rails_helper"

RSpec.describe PayrollCalendarPeriod, type: :model do
  it "reports invalid policy fields without evaluating the cutoff calculation" do
    period = build(:payroll_calendar_period, time_zone: "UTC", cutoff_days_before: nil)

    expect(period).not_to be_valid
    expect(period.errors[:time_zone]).to include("is not included in the list")
    expect(period.errors[:cutoff_days_before]).to be_present
  end

  it "only schedules failed periods that have a retry time" do
    guam = ActiveSupport::TimeZone["Pacific/Guam"]
    now = guam.local(2026, 12, 1, 17)
    scheduled = create(
      :payroll_calendar_period,
      start_date: Date.new(2026, 10, 1),
      end_date: Date.new(2026, 10, 15),
      pay_date: Date.new(2026, 10, 25),
      cutoff_at: guam.local(2026, 10, 18, 17),
      next_finalization_attempt_at: nil
    )
    retryable = create(
      :payroll_calendar_period,
      start_date: Date.new(2026, 10, 16),
      end_date: Date.new(2026, 10, 31),
      pay_date: Date.new(2026, 11, 10),
      cutoff_at: guam.local(2026, 11, 3, 17),
      status: "failed",
      next_finalization_attempt_at: now
    )
    blocked = create(
      :payroll_calendar_period,
      start_date: Date.new(2026, 11, 1),
      end_date: Date.new(2026, 11, 15),
      pay_date: Date.new(2026, 11, 25),
      cutoff_at: guam.local(2026, 11, 18, 17),
      status: "failed",
      next_finalization_attempt_at: nil
    )

    expect(described_class.due_at(now)).to contain_exactly(scheduled, retryable)
    expect(described_class.due_at(now)).not_to include(blocked)
  end


  it "enforces the exact T-7 calendar date in Pacific/Guam" do
    guam = ActiveSupport::TimeZone["Pacific/Guam"]
    attributes = {
      start_date: Date.new(2025, 12, 16),
      end_date: Date.new(2025, 12, 31),
      pay_date: Date.new(2026, 1, 10)
    }

    exact = build(:payroll_calendar_period, **attributes, cutoff_at: guam.local(2026, 1, 3, 23, 59))
    preceding = build(:payroll_calendar_period, **attributes, cutoff_at: guam.local(2026, 1, 2, 23, 59))
    following = build(:payroll_calendar_period, **attributes, cutoff_at: guam.local(2026, 1, 4, 0, 1))
    utc_boundary = build(
      :payroll_calendar_period,
      **attributes,
      cutoff_at: Time.iso8601("2026-01-02T14:00:01Z")
    )

    expect(exact).to be_valid
    expect(utc_boundary).to be_valid
    [ preceding, following ].each do |period|
      expect(period).not_to be_valid
      expect(period.errors[:cutoff_at]).to include("must fall seven calendar days before the pay date in Pacific/Guam")
    end
  end
end
