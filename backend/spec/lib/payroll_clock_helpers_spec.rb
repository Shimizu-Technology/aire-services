# frozen_string_literal: true

require "rails_helper"
require_relative "../support/payroll_clock_helpers"

RSpec.describe PayrollClockHelpers do
  describe ".payroll_dates_before" do
    {
      "2026-03-15" => [ "2026-02-16", "2026-02-28" ],
      "2026-03-16" => [ "2026-03-01", "2026-03-15" ],
      "2026-03-31" => [ "2026-03-01", "2026-03-15" ],
      "2027-01-05" => [ "2026-12-16", "2026-12-31" ],
      "2028-03-03" => [ "2028-02-16", "2028-02-29" ]
    }.each do |pay_date, expected_range|
      it "selects the complete nominal period before #{pay_date}" do
        expect(described_class.payroll_dates_before(Date.iso8601(pay_date)))
          .to eq(expected_range.map { |date| Date.iso8601(date) })
      end
    end
  end

  describe ".payroll_calendar_at" do
    {
      "2026-03-08T17:00:00+10:00" => [ "2026-02-16", "2026-02-28", "2026-03-15" ],
      "2026-03-09T17:00:00+10:00" => [ "2026-03-01", "2026-03-15", "2026-03-16" ],
      "2026-03-24T17:00:00+10:00" => [ "2026-03-01", "2026-03-15", "2026-03-31" ],
      "2026-12-29T17:00:00+10:00" => [ "2026-12-16", "2026-12-31", "2027-01-05" ],
      "2028-02-25T17:00:00+10:00" => [ "2028-02-16", "2028-02-29", "2028-03-03" ],
      "2026-03-08T14:30:00Z" => [ "2026-03-01", "2026-03-15", "2026-03-16" ]
    }.each do |cutoff, expected_dates|
      it "derives a Guam T-7 calendar from #{cutoff}" do
        cutoff_at = Time.iso8601(cutoff)
        start_date, end_date, pay_date = expected_dates.map { |date| Date.iso8601(date) }

        expect(described_class.payroll_calendar_at(cutoff_at)).to eq(
          start_date: start_date, end_date: end_date, pay_date: pay_date,
          cutoff_at: cutoff_at, next_finalization_attempt_at: cutoff_at
        )
      end
    end
  end
end
