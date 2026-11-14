# frozen_string_literal: true

require "rails_helper"

# Two saves at once (Require on, and schedules off) must never leave schedules
# off with Require on: that refuses every clock-in with no shift and hides the
# Schedule page where shifts are added. The test holds the settings lock from an
# independent connection, lets both requests queue behind it in a known order,
# then releases it.
RSpec.describe "Admin settings: schedules and Require under concurrent saves", type: :request do
  self.use_transactional_tests = false

  LOCK_KEY = Setting::SCHEDULE_REQUIREMENT_ADVISORY_LOCK_KEY
  KEYS = %w[schedules_enabled schedule_required_for_clock_in].freeze

  let!(:admin) { create(:user, :admin) }
  let(:locker) { independent_database_connection }

  before do
    @audit_floor = AuditLog.maximum(:id) || 0
    Setting.set("schedules_enabled", "true")
    Setting.set("schedule_required_for_clock_in", "false")
  end

  after do
    locker.close unless locker.finished?
    # Committed audit rows would leak into other specs, so remove this example's rows
    # (the append-only trigger is lifted for the delete, as the payroll specs do).
    AuditLog.transaction do
      connection = AuditLog.connection
      connection.execute("ALTER TABLE audit_logs DISABLE TRIGGER audit_logs_append_only")
      AuditLog.where("id > ?", @audit_floor).delete_all
      connection.execute("ALTER TABLE audit_logs ENABLE TRIGGER audit_logs_append_only")
    end
    Setting.where(key: KEYS).delete_all
    User.where(id: admin.id).destroy_all
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

  def save_in_thread(settings)
    Thread.new do
      ActiveRecord::Base.connection_pool.with_connection do
        session = ActionDispatch::Integration::Session.new(Rails.application)
        session.patch(
          "/api/v1/admin/settings",
          params: { settings: settings }.to_json,
          headers: { "Authorization" => "Bearer test_token_#{admin.id}", "CONTENT_TYPE" => "application/json" }
        )
        session.response.status
      end
    end
  end

  def waiting_for_lock
    locker.exec("SELECT count(*) FROM pg_locks WHERE locktype = 'advisory' AND objid = #{LOCK_KEY} AND NOT granted").getvalue(0, 0).to_i
  end

  def wait_until_queued(count)
    deadline = Process.clock_gettime(Process::CLOCK_MONOTONIC) + 10
    sleep 0.02 until waiting_for_lock >= count || Process.clock_gettime(Process::CLOCK_MONOTONIC) > deadline
    expect(waiting_for_lock).to eq(count)
  end

  def run_in_order(first, second)
    locker.exec("SELECT pg_advisory_lock(#{LOCK_KEY})")
    one = save_in_thread(first)
    wait_until_queued(1)
    two = save_in_thread(second)
    wait_until_queued(2)
    locker.exec("SELECT pg_advisory_unlock(#{LOCK_KEY})")
    [ one.value, two.value ]
  end

  def stored(key)
    Setting.where(key: key).pick(:value)
  end

  let(:require_on) { { schedule_required_for_clock_in: true } }
  let(:schedules_off) { { schedules_enabled: false } }

  it "turns Require off when schedules go off after Require was turned on" do
    statuses = run_in_order(require_on, schedules_off)

    expect(statuses).to eq([ 200, 200 ])
    expect(stored("schedules_enabled")).to eq("false")
    expect(stored("schedule_required_for_clock_in")).to eq("false")
    rows = AuditLog.where(action: "setting.schedule_required_for_clock_in_updated").order(:id).map(&:changes_made)
    expect(rows).to eq([
      { "schedule_required_for_clock_in" => [ false, true ] },
      { "schedule_required_for_clock_in" => [ true, false ] }
    ])
  end

  it "refuses Require when schedules were turned off first" do
    statuses = run_in_order(schedules_off, require_on)

    expect(statuses).to eq([ 200, 422 ])
    expect(stored("schedules_enabled")).to eq("false")
    expect(stored("schedule_required_for_clock_in")).to eq("false")
    expect(AuditLog.where(action: "setting.schedule_required_for_clock_in_updated")).to be_empty
  end
end
