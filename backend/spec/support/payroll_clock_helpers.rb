# frozen_string_literal: true

module PayrollClockHelpers
  extend self

  def database_clock
    ActiveRecord::Base.connection.select_value("SELECT clock_timestamp()").in_time_zone("Pacific/Guam")
  end

  # Call only after seeding the source state/holds that must exist at cutoff.
  # Rails travel_to does not move PostgreSQL's revision or immutability clocks.
  def capture_payroll_cutoff
    database_clock
  end

  def wait_for_database_cutoff(cutoff)
    remaining = cutoff - database_clock
    raise "Fixture cutoff wait exceeds two seconds" if remaining > 2

    sleep(remaining + 0.001) if remaining.positive?
    raise "Database cutoff has not passed" unless database_clock > cutoff
  end

  def payroll_dates_before(pay_date)
    end_date = pay_date.day > 15 ? pay_date.change(day: 15) : (pay_date << 1).end_of_month
    start_date = end_date.day == 15 ? end_date.beginning_of_month : end_date.change(day: 16)
    [ start_date, end_date ]
  end

  def payroll_calendar_at(cutoff_at)
    pay_date = cutoff_at.in_time_zone("Pacific/Guam").to_date + 7.days
    start_date, end_date = payroll_dates_before(pay_date)
    { start_date: start_date, end_date: end_date, pay_date: pay_date,
      cutoff_at: cutoff_at, next_finalization_attempt_at: cutoff_at }
  end

  def next_payroll_start(start_date)
    start_date.day == 1 ? start_date.change(day: 16) : start_date.next_month.beginning_of_month
  end

  def payroll_calendar_for(start_date)
    end_date = start_date.day == 1 ? start_date.change(day: 15) : start_date.end_of_month
    pay_date = start_date.day == 1 ? start_date.change(day: 25) : start_date.next_month.change(day: 10)
    cutoff_date = pay_date - 7.days
    cutoff_at = ActiveSupport::TimeZone["Pacific/Guam"].local(cutoff_date.year, cutoff_date.month, cutoff_date.day, 17)
    { start_date: start_date, end_date: end_date, pay_date: pay_date,
      cutoff_at: cutoff_at, next_finalization_attempt_at: cutoff_at }
  end

  def payroll_time(date, hour: 17, min: 0, usec: 0)
    ActiveSupport::TimeZone["Pacific/Guam"].local(date.year, date.month, date.day, hour, min).change(usec: usec)
  end

  def future_payroll_month
    database_clock.to_date.next_month.beginning_of_month
  end
end
