# frozen_string_literal: true

require "rails_helper"
require "pg"
require Rails.root.join("db/migrate/20261024040000_capture_payable_interval_chronology")

RSpec.describe "Interval migration acquisition budget" do
  self.use_transactional_tests = false

  [ "payroll_batches", "time_entries" ].each do |table|
    it "times out before DDL on a long reader of #{table}" do
      config = ApplicationRecord.connection_db_config.configuration_hash
      expect(ApplicationRecord.connection.select_value("SELECT current_database()")).to eq(config.fetch(:database))
      params = config.slice(:host, :port, :password).merge(dbname: config.fetch(:database), user: config[:username]).compact
      blocker = PG.connect(params)
      schema = "interval_migration_#{SecureRandom.hex(6)}"
      quoted = PG::Connection.quote_ident(schema)
      blocker.exec("CREATE SCHEMA #{quoted}")
      blocker.exec("CREATE TABLE #{quoted}.payroll_batches (id bigint)")
      blocker.exec("CREATE TABLE #{quoted}.time_entries (id bigint)")
      blocker.exec("CREATE TABLE #{quoted}.time_entry_breaks (id bigint)")
      blocker.exec("BEGIN")
      blocker.exec("SELECT 1 FROM #{quoted}.#{table}")
      result = Queue.new
      worker = Thread.new do
        ApplicationRecord.connection_pool.with_connection do |connection|
          path = connection.schema_search_path
          connection.schema_search_path = schema
          connection.execute("BEGIN")
          connection.execute("SET LOCAL statement_timeout = '7500ms'")
          migration = CapturePayableIntervalChronology.new
          migration.define_singleton_method(:connection) { connection }
          started = Process.clock_gettime(Process::CLOCK_MONOTONIC)
          begin
            ActiveRecord::Migration.suppress_messages { migration.up }
            result << [ nil, Process.clock_gettime(Process::CLOCK_MONOTONIC) - started ]
          rescue StandardError => e
            result << [ e, Process.clock_gettime(Process::CLOCK_MONOTONIC) - started ]
          ensure
            connection.execute("ROLLBACK")
            connection.schema_search_path = path
          end
        end
      end
      expect(worker.join(12)).to be_present
      error, elapsed = result.pop
      RSpec.configuration.reporter.message("Migration lock: table=#{table} elapsed=#{elapsed.round(2)}s error=#{error.class}")
      expect(error).to be_a(ActiveRecord::LockWaitTimeout)
      expect(error.message).to match(/lock timeout/)
      expect(elapsed).to be_between(4.5, 6.8)
    ensure
      blocker&.exec("ROLLBACK")
      worker&.join(12)
      blocker&.exec("DROP SCHEMA #{quoted} CASCADE") if quoted
      blocker&.close
    end
  end
end
