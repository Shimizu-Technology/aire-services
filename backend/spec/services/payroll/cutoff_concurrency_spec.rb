# frozen_string_literal: true

require "rails_helper"
require "timeout"

RSpec.describe "Payroll cutoff concurrency" do
  include ActiveSupport::Testing::TimeHelpers

  self.use_transactional_tests = false

  after do
    connection = ActiveRecord::Base.connection
    connection.execute("ALTER TABLE payroll_settlement_case_events DISABLE TRIGGER payroll_settlement_case_events_prevent_truncate")
    begin
      connection.execute(<<~SQL)
        TRUNCATE TABLE
          payroll_settlement_case_events,
          payroll_settlement_cases,
          payroll_outbox_events,
          payroll_calendar_period_revisions,
          payroll_calendar_periods,
          payroll_entry_processing_events,
          payroll_batch_processing_events,
          payroll_batch_exclusions,
          payroll_batch_entries,
          payroll_batches,
          audit_logs
        RESTART IDENTITY CASCADE
      SQL
    ensure
      connection.execute("ALTER TABLE payroll_settlement_case_events ENABLE TRIGGER payroll_settlement_case_events_prevent_truncate")
    end
  end

  it "turns concurrent publication retries into one retained revision" do
    attributes = {
      external_pay_period_id: "concurrent-calendar-period",
      start_date: "2026-10-01",
      end_date: "2026-10-15",
      pay_date: "2026-10-25",
      cutoff_at: "2026-10-18T17:00:00+10:00",
      time_zone: "Pacific/Guam",
      cutoff_days_before: 7,
      schedule_version: 1,
      publication_id: SecureRandom.uuid
    }
    now = Time.iso8601("2026-10-01T09:00:00+10:00")
    ready = Queue.new
    start = Queue.new
    workers = 2.times.map do
      Thread.new do
        ActiveRecord::Base.connection_pool.with_connection do
          ready << true
          start.pop
          Payroll::CalendarPeriodPublisher.new(attributes, now: now).call
        end
      end
    end

    2.times { ready.pop }
    2.times { start << true }
    results = workers.map(&:value)

    expect(results.map(&:created)).to contain_exactly(true, false)
    expect(results.map(&:idempotent)).to contain_exactly(false, true)
    expect(PayrollCalendarPeriod.count).to eq(1)
    expect(PayrollCalendarPeriodRevision.count).to eq(1)
  end

  it "samples publication time after an advisory-lock wait crosses the cutoff" do
    cutoff = Time.iso8601("2026-10-03T17:00:00+10:00")
    attributes = {
      external_pay_period_id: "lock-wait-calendar-period",
      start_date: "2026-09-16",
      end_date: "2026-09-30",
      pay_date: "2026-10-10",
      cutoff_at: cutoff.in_time_zone("Pacific/Guam").iso8601(6),
      time_zone: "Pacific/Guam",
      cutoff_days_before: 7,
      schedule_version: 1,
      publication_id: SecureRandom.uuid
    }
    lock_ready = Queue.new
    release_lock = Queue.new
    outcome = Queue.new
    lock_released = false
    locker = Thread.new do
      ActiveRecord::Base.connection_pool.with_connection do |connection|
        connection.execute("SELECT pg_advisory_lock(#{Payroll::CalendarPeriodPublisher::ADVISORY_LOCK_KEY})")
        lock_ready << true
        release_lock.pop
        connection.execute("SELECT pg_advisory_unlock(#{Payroll::CalendarPeriodPublisher::ADVISORY_LOCK_KEY})")
      end
    end

    lock_ready.pop
    travel_to(cutoff - 1.second)
    publisher = Thread.new do
      ActiveRecord::Base.connection_pool.with_connection do
        outcome << Payroll::CalendarPeriodPublisher.new(attributes).call
      rescue StandardError => e
        outcome << e
      end
    end
    Timeout.timeout(5) do
      loop do
        waiting = ActiveRecord::Base.connection.select_value(<<~SQL).to_i
          SELECT COUNT(*)
          FROM pg_locks
          WHERE locktype = 'advisory'
            AND objid = #{Payroll::CalendarPeriodPublisher::ADVISORY_LOCK_KEY}
            AND NOT granted
        SQL
        break if waiting.positive?

        Thread.pass
      end
    end

    travel_to(cutoff)
    release_lock << true
    lock_released = true
    result = outcome.pop

    expect(result).to be_a(ArgumentError)
    expect(result.message).to include("cutoff_at must be in the future when published")
    expect(PayrollCalendarPeriod).not_to exist
  ensure
    release_lock << true if defined?(release_lock) && !lock_released
    publisher&.join
    locker&.join
    travel_back
  end

  it "creates one immutable batch and one outbox event under competing workers" do
    cutoff = 1.minute.ago
    pay_date = cutoff.in_time_zone("Pacific/Guam").to_date + 7
    start_date = pay_date.prev_month.beginning_of_month
    end_date = start_date + 14.days
    period = create(
      :payroll_calendar_period,
      external_pay_period_id: "concurrent-cutoff-period",
      start_date: start_date,
      end_date: end_date,
      pay_date: pay_date,
      cutoff_at: cutoff,
      next_finalization_attempt_at: cutoff
    )
    ready = Queue.new
    start = Queue.new
    workers = 2.times.map do
      Thread.new do
        ActiveRecord::Base.connection_pool.with_connection do
          ready << true
          start.pop
          Payroll::ScheduledCutoffFinalizer.new(period_id: period.id).call
        end
      end
    end

    2.times { ready.pop }
    2.times { start << true }
    results = workers.map(&:value)

    expect(results.count { |result| result[:status] == "finalized" }).to be_between(1, 2)
    expect(results.map { |result| result[:status] }).to all(satisfy { |status| status.in?(%w[finalized skipped]) })
    expect(PayrollBatch.count).to eq(1)
    expect(PayrollOutboxEvent.count).to eq(1)
    expect(period.reload.payroll_batch).to eq(PayrollBatch.first)
  end
end
