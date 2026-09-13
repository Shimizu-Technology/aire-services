# frozen_string_literal: true

FactoryBot.define do
  factory :payroll_calendar_period do
    transient do
      sequence(:period_number) { |number| number }
    end

    sequence(:external_pay_period_id) { |number| "cornerstone-period-#{number}" }
    start_date { Date.new(2026, 10, 1).next_month(period_number - 1) }
    end_date { start_date.change(day: 15) }
    pay_date { start_date.next_month.change(day: 10) }
    cutoff_at { ActiveSupport::TimeZone["Pacific/Guam"].local(pay_date.year, pay_date.month, pay_date.day, 17) - 7.days }
    time_zone { "Pacific/Guam" }
    cutoff_days_before { 7 }
    schedule_version { 1 }
    publication_id { SecureRandom.uuid }
    request_checksum { Digest::SHA256.hexdigest(external_pay_period_id) }
    status { "scheduled" }
    next_finalization_attempt_at { cutoff_at }
  end
end
