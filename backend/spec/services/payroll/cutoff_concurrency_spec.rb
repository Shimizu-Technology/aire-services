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

  def publication_attributes(cutoff: 1.day.from_now)
    {
      external_pay_period_id: "publication-finalization-race", start_date: "2026-10-01", end_date: "2026-10-15",
      pay_date: cutoff.in_time_zone("Pacific/Guam").to_date + 7.days, cutoff_at: cutoff.iso8601(6),
      time_zone: "Pacific/Guam", cutoff_days_before: 7, schedule_version: 1, publication_id: SecureRandom.uuid
    }
  end

  def database_worker(pids, &work)
    Thread.new do
      ActiveRecord::Base.connection_pool.with_connection do |connection|
        pids << connection.select_value("SELECT pg_backend_pid()").to_i
        work.call
      rescue StandardError => e
        e
      end
    end
  end

  def wait_for_blocker(waiter_pid, blocker_pid)
    Timeout.timeout(5) do
      loop do
        blocked = ActiveRecord::Base.connection.select_value(
          "SELECT #{blocker_pid} = ANY(pg_blocking_pids(#{waiter_pid}))"
        )
        break if blocked
        Thread.pass
      end
    end
  end

  it "makes a manual finalizer wait for publication, then rejects the competing batch" do
    attributes = publication_attributes
    entered = Queue.new
    release = Queue.new
    publisher_pids = Queue.new
    finalizer_pids = Queue.new
    publisher_service = Payroll::CalendarPeriodPublisher.new(attributes)
    allow(publisher_service).to receive(:record_revision!).and_wrap_original do |original, period|
      entered << true
      release.pop
      original.call(period)
    end
    publisher = database_worker(publisher_pids) { publisher_service.call }
    publisher_pid = publisher_pids.pop
    entered.pop
    finalizer = database_worker(finalizer_pids) do
      Payroll::BatchFinalizer.new(start_date: attributes[:start_date], end_date: attributes[:end_date], actor: nil).call
    end
    wait_for_blocker(finalizer_pids.pop, publisher_pid)
    release << true
    expect(publisher.value).to be_a(Payroll::CalendarPeriodPublisher::Result)
    expect(finalizer.value).to be_a(Payroll::BatchFinalizer::FinalizationError)
    expect(PayrollCalendarPeriod.count).to eq(1)
    expect(PayrollBatch.count).to eq(0)
    expect(PayrollOutboxEvent.count).to eq(0)
  ensure
    release << true if defined?(release)
    publisher&.join
    finalizer&.join
  end

  it "makes publication wait for a manual finalizer, then rejects the frozen conflict" do
    attributes = publication_attributes
    entered = Queue.new
    release = Queue.new
    publisher_pids = Queue.new
    finalizer_pids = Queue.new
    service = Payroll::BatchFinalizer.new(start_date: attributes[:start_date], end_date: attributes[:end_date], actor: nil)
    allow(service).to receive(:lock_source_ledger!).and_wrap_original do |original|
      original.call
      entered << true
      release.pop
    end
    finalizer = database_worker(finalizer_pids) { service.call }
    finalizer_pid = finalizer_pids.pop
    entered.pop
    publisher = database_worker(publisher_pids) { Payroll::CalendarPeriodPublisher.new(attributes).call }
    wait_for_blocker(publisher_pids.pop, finalizer_pid)
    release << true
    expect(finalizer.value).to be_a(PayrollBatch)
    expect(publisher.value).to be_a(Payroll::CalendarPeriodPublisher::ConflictError)
    expect(PayrollCalendarPeriod.count).to eq(0)
    expect(PayrollCalendarPeriodRevision.count).to eq(0)
    expect(PayrollBatch.count).to eq(1)
    expect(PayrollOutboxEvent.count).to eq(0)
  ensure
    release << true if defined?(release)
    publisher&.join
    finalizer&.join
  end

  it "does not invert publisher and scheduled-finalizer locks while a period row is held" do
    cutoff = 1.minute.ago
    attributes = publication_attributes(cutoff: cutoff)
    period = create(:payroll_calendar_period, attributes.except(:schema_version).merge(
      cutoff_at: cutoff, next_finalization_attempt_at: cutoff, request_checksum: "a" * 64))
    release = Queue.new
    locker_pids = Queue.new
    cutoff_pids = Queue.new
    publisher_pids = Queue.new
    locker = database_worker(locker_pids) do
      ActiveRecord::Base.transaction do
        ActiveRecord::Base.connection.execute("SELECT pg_advisory_xact_lock(#{Payroll::BatchFinalizer::ADVISORY_LOCK_KEY})")
        release.pop
      end
    end
    locker_pid = locker_pids.pop
    finalizer = database_worker(cutoff_pids) { Payroll::ScheduledCutoffFinalizer.new(period_id: period.id).call }
    finalizer_pid = cutoff_pids.pop
    wait_for_blocker(finalizer_pid, locker_pid)
    revised = attributes.merge(schedule_version: 2, publication_id: SecureRandom.uuid)
    publisher = database_worker(publisher_pids) do
      Payroll::CalendarPeriodPublisher.new(revised, now: cutoff - 1.hour).call
    end
    wait_for_blocker(publisher_pids.pop, finalizer_pid)
    release << true
    expect(finalizer.value).to include(status: "finalized")
    expect(publisher.value).to be_a(Payroll::CalendarPeriodPublisher::ConflictError)
    expect(period.reload.status).to eq("finalized")
    expect(PayrollBatch.count).to eq(1)
    expect(PayrollOutboxEvent.count).to eq(1)
  ensure
    release << true if defined?(release)
    locker&.join
    finalizer&.join
    publisher&.join
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

  it "waits for finalization before an evidence command can read and claim source hours" do
    actor = create(:user, :admin)
    period = create(:payroll_calendar_period)
    lock_ready = Queue.new
    release_lock = Queue.new
    entered = Queue.new
    locker = Thread.new do
      ActiveRecord::Base.connection_pool.with_connection do |connection|
        connection.transaction do
          connection.execute("SELECT pg_advisory_xact_lock(#{Payroll::BatchFinalizer::ADVISORY_LOCK_KEY})")
          lock_ready << true
          release_lock.pop
        end
      end
    end
    lock_ready.pop
    worker = Thread.new do
      ActiveRecord::Base.connection_pool.with_connection do
        Payroll::CockpitCommand.new(command_id: SecureRandom.uuid, action: "payroll_manual_allocation.commit",
                                    actor: actor, target: period, expected_version: period.lock_version, payload: {}).call do
          entered << true
          [ {}, :created, {} ]
        end
      end
    end
    Timeout.timeout(5) do
      loop do
        waiting = ActiveRecord::Base.connection.select_value(<<~SQL).to_i
          SELECT COUNT(*) FROM pg_locks
          WHERE locktype = 'advisory' AND objid = #{Payroll::BatchFinalizer::ADVISORY_LOCK_KEY} AND NOT granted
        SQL
        break if waiting.positive?

        Thread.pass
      end
    end
    expect(entered).to be_empty
    release_lock << true
    locker.join
    expect(worker.value.status).to eq(201)
    expect(entered.pop).to eq(true)
  ensure
    release_lock << true if defined?(release_lock)
    worker&.join
    locker&.join
    if actor
      connection = ActiveRecord::Base.connection
      connection.execute("ALTER TABLE payroll_integration_commands DISABLE TRIGGER payroll_integration_commands_append_only")
      begin
        PayrollIntegrationCommand.where(actor_id: actor.id).delete_all
      ensure
        connection.execute("ALTER TABLE payroll_integration_commands ENABLE TRIGGER payroll_integration_commands_append_only")
      end
      actor.delete
    end
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
