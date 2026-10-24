# frozen_string_literal: true

require "rails_helper"

RSpec.describe "Affected overtime concurrency" do
  self.use_transactional_tests = false

  around do |example|
    count = AuditLog.count
    example.run
    expect(AuditLog.count).to eq(count)
    expect(AuditLog.connection.select_value("SELECT tgenabled FROM pg_trigger WHERE tgname = 'audit_logs_append_only'")).to eq("O")
  end

  # Threads need committed fixtures. Remove only their audit rows in this
  # private test database; transactional DDL restores the append-only guard
  # even if teardown fails. Application code never bypasses this guard.
  def clear_fixture_audits(entry_ids)
    raise "test fixture teardown only" unless Rails.env.test?

    AuditLog.transaction do
      connection = AuditLog.connection
      raise "wrong test database" unless connection.select_value("SELECT current_database()") == ApplicationRecord.connection_db_config.database
      connection.execute("ALTER TABLE audit_logs DISABLE TRIGGER audit_logs_append_only")
      AuditLog.where(auditable_type: "TimeEntry", auditable_id: entry_ids).delete_all
      connection.execute("ALTER TABLE audit_logs ENABLE TRIGGER audit_logs_append_only")
    end
  end

  it "serializes clock-out and an earlier approval into one review allocation" do
    zone = ActiveSupport::TimeZone["Pacific/Guam"]
    sunday = zone.now.to_date.beginning_of_week(:sunday) - 7
    admin = create(:user, :admin)
    user = create(:user, :employee)
    category = create(:time_category)
    schedule = Schedule.create!(user: user, work_date: sunday + 5, start_time: "08:00", end_time: "16:00")
    build_shift = lambda do |date, **attrs|
      from = zone.local(date.year, date.month, date.day, 8)
      create(:time_entry, user: user, time_category: category, work_date: date,
        entry_method: "clock", status: "completed", approval_status: nil,
        start_time: from, end_time: from + 8.hours, clock_in_at: from, clock_out_at: from + 8.hours, **attrs)
    end
    earlier = build_shift.call(sunday, approval_status: "pending")
    4.times { |i| build_shift.call(sunday + i + 1) }
    friday = build_shift.call(sunday + 5, schedule: schedule, status: "clocked_in", end_time: nil, clock_out_at: nil, hours: 0)
    stop = zone.local(friday.work_date.year, friday.work_date.month, friday.work_date.day, 16)
    allow(Time).to receive(:current).and_return(stop)
    ready = Queue.new
    start = Queue.new
    errors = Queue.new
    threads = [
      -> { TimeClockService.approve_entry(entry: TimeEntry.find(earlier.id), approved_by: admin) },
      -> { TimeClockService.clock_out(user: User.find(user.id)) }
    ].map do |action|
      Thread.new do
        ActiveRecord::Base.connection_pool.with_connection do
          ready << true
          start.pop
          action.call
        end
      rescue StandardError => e
        errors << e
      end
    end
    2.times { ready.pop }
    2.times { start << true }
    threads.each { |thread| expect(thread.join(10)).to be_present }
    raise errors.pop unless errors.empty?

    expect(friday.reload).to have_attributes(hours: 8, overtime_status: "pending", overtime_approved_at: nil)
    expect(friday.overtime_allocation_signature.last).to eq([ [ friday.work_date.to_s, 0.0, 8.0 ] ])
    result = Payroll::BatchBuilder.new(start_date: sunday.to_s, end_date: (sunday + 6).to_s).call
    expect(result[:rows].select { |row| row[:source_time_entry_id] == friday.id }).to be_empty
  ensure
    threads&.each { |thread| thread.join(10) }
    if user
      clear_fixture_audits(TimeEntry.where(user: user).pluck(:id))
      TimeEntry.where(user: user).delete_all
      Schedule.where(user: user).delete_all
      User.where(id: user.id).destroy_all
    end
    User.where(id: admin&.id).destroy_all
    category&.destroy!
  end
  it "orders a cockpit-style entry lock against a bulk employee-first approval" do
    user = create(:user, :employee)
    category = create(:time_category)
    entry = create(:time_entry, user: user, time_category: category, work_date: BusinessDate.today - 7,
      entry_method: "clock", status: "completed", approval_status: nil)
    locked = Queue.new
    errors = Queue.new
    threads = [
      Thread.new do
        ActiveRecord::Base.connection_pool.with_connection do
          TimeEntry.transaction do
            ActiveRecord::Base.connection.execute("SET LOCAL lock_timeout = '3s'")
            row = TimeEntry.find(entry.id)
            row.lock!
            locked << true
            sleep 0.1
            row.update!(end_time: row.end_time + 1.hour)
          end
        end
      rescue StandardError => e
        errors << e
      end,
      Thread.new do
        locked.pop
        ActiveRecord::Base.connection_pool.with_connection do
          TimeEntry.transaction do
            ActiveRecord::Base.connection.execute("SET LOCAL lock_timeout = '3s'")
            User.where(id: user.id).order(:id).lock.load
            row = TimeEntry.where(id: entry.id).order(:id).lock.sole
            row.update!(description: "Bulk review retained context")
          end
        end
      rescue StandardError => e
        errors << e
      end
    ]
    threads.each { |thread| expect(thread.join(10)).to be_present }
    raise errors.pop unless errors.empty?
    expect(entry.reload.hours).to eq(9)
    expect(entry.description).to eq("Bulk review retained context")
  ensure
    threads&.each { |thread| thread.kill if thread.alive? }
    clear_fixture_audits([ entry.id ]) if entry
    TimeEntry.where(user_id: user&.id).delete_all if user
    user&.destroy!
    category&.destroy!
  end
end
