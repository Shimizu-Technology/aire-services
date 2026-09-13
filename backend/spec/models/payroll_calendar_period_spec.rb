# frozen_string_literal: true

require "rails_helper"

RSpec.describe PayrollCalendarPeriod, type: :model do
  it "reports invalid policy fields without evaluating the cutoff calculation" do
    period = build(:payroll_calendar_period, time_zone: "UTC", cutoff_days_before: nil)

    expect(period).not_to be_valid
    expect(period.errors[:time_zone]).to include("is not included in the list")
    expect(period.errors[:cutoff_days_before]).to be_present
  end
end
