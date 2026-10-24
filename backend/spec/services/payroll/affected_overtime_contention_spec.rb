# frozen_string_literal: true

require "rails_helper"

RSpec.describe "Affected overtime concurrency" do
  self.use_transactional_tests = false

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
      TimeEntry.where(user: user).delete_all
      Schedule.where(user: user).delete_all
      User.where(id: user.id).destroy_all
    end
    User.where(id: admin&.id).destroy_all
    category&.destroy!
  end
end
