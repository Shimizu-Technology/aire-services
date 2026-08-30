# frozen_string_literal: true

require "rails_helper"

RSpec.describe "TimeClockService stale-entry contention", type: :service do
  self.use_transactional_tests = false

  let!(:user) do
    create(
      :user,
      :employee,
      email: "stale-contention-#{SecureRandom.hex(8)}@example.test",
      clerk_id: "stale_contention_#{SecureRandom.hex(8)}"
    )
  end
  let!(:stale_entry) do
    create(
      :time_entry,
      user: user,
      status: "clocked_in",
      clock_in_at: 13.hours.ago,
      start_time: 13.hours.ago,
      end_time: nil,
      hours: nil
    )
  end

  after do
    AuditLog.where(auditable_type: "TimeEntry", auditable_id: stale_entry.id).delete_all
    TimeEntry.where(id: stale_entry.id).delete_all
    User.where(id: user.id).destroy_all
  end

  it "returns promptly without changing the entry when payroll finalization blocks the ledger" do
    locker = independent_database_connection
    locker.exec("BEGIN")
    locker.exec("LOCK TABLE time_entries IN SHARE MODE")
    stub_const("TimeClockService::PUNCH_LOCK_TIMEOUT", "50ms")

    expect do
      TimeClockService.flag_stale_entries(threshold_hours: 12)
    end.not_to change { stale_entry.reload.attributes.slice("status", "clock_out_at", "hours") }

    expect(AuditLog.where(auditable: stale_entry, action: "time_entry.auto_closed")).to be_empty
  ensure
    locker&.exec("ROLLBACK")
    locker&.close
  end

  def independent_database_connection
    database_config = ActiveRecord::Base.connection_db_config.configuration_hash
    PG.connect(
      host: database_config[:host],
      port: database_config[:port],
      user: database_config[:username],
      password: database_config[:password],
      dbname: database_config.fetch(:database)
    )
  end
end
