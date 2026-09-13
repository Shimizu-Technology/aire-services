# frozen_string_literal: true

require "rails_helper"

RSpec.describe "Payroll cutoff concurrency" do
  self.use_transactional_tests = false

  after do
    ActiveRecord::Base.connection.execute(<<~SQL)
      TRUNCATE TABLE
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

    expect(results).to all(include(status: "finalized"))
    expect(PayrollBatch.count).to eq(1)
    expect(PayrollOutboxEvent.count).to eq(1)
    expect(period.reload.payroll_batch).to eq(PayrollBatch.first)
  end
end
