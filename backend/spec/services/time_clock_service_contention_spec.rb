# frozen_string_literal: true

require "rails_helper"

RSpec.describe "TimeClockService payroll-finalization contention", type: :service do
  self.use_transactional_tests = false

  let!(:user) do
    create(
      :user,
      :employee,
      email: "stale-contention-#{SecureRandom.hex(8)}@example.test",
      clerk_id: "stale_contention_#{SecureRandom.hex(8)}",
      time_tracking_enabled: true,
      kiosk_enabled: true
    )
  end
  let(:stale_entry) do
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
    entry_ids = TimeEntry.where(user_id: user.id).pluck(:id)
    AuditLog.where(auditable_type: "TimeEntry", auditable_id: entry_ids).delete_all
    TimeEntry.where(id: entry_ids).delete_all
    UserTimeCategory.where(user_id: user.id).delete_all
    User.where(id: user.id).destroy_all
    @time_category&.destroy!
  end

  it "returns a retryable message without partial clock-in writes" do
    expect(Setting.get("schedule_required_for_clock_in")).to eq("false")
    @time_category = create(:time_category)
    UserTimeCategory.create!(user: user, time_category: @time_category)
    locker = independent_database_connection
    locker.exec("BEGIN")
    locker.exec("LOCK TABLE time_entries IN SHARE MODE")
    stub_const("TimeClockService::PUNCH_LOCK_TIMEOUT", "50ms")

    expect do
      TimeClockService.clock_in(user: user, time_category_id: @time_category.id)
    end.to raise_error(TimeClockService::ClockError, /Payroll is being finalized.*try.*again/i)

    expect(user.time_entries).to be_empty
    expect(AuditLog.where(action: "time_entry.clocked_in")).to be_empty
  ensure
    locker&.exec("ROLLBACK")
    locker&.close
  end

  it "returns promptly without changing the entry when payroll finalization blocks the ledger" do
    entry = stale_entry
    locker = independent_database_connection
    locker.exec("BEGIN")
    locker.exec("LOCK TABLE time_entries IN SHARE MODE")
    stub_const("TimeClockService::PUNCH_LOCK_TIMEOUT", "50ms")

    expect do
      TimeClockService.flag_stale_entries(threshold_hours: 12)
    end.not_to change { entry.reload.attributes.slice("status", "clock_out_at", "hours") }

    expect(AuditLog.where(auditable: entry, action: "time_entry.auto_closed")).to be_empty
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
