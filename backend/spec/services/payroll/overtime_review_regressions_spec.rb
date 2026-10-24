# frozen_string_literal: true

require "rails_helper"

RSpec.describe "Overtime review correctness and bounded work" do
  let(:user) { create(:user, :employee) }
  let(:admin) { create(:user, :admin) }
  let(:category) { create(:time_category) }
  let(:zone) { ActiveSupport::TimeZone["Pacific/Guam"] }
  let(:sunday) { Date.new(2026, 10, 18) }

  def shift(date, seconds = 8.hours, hour: 8, **attrs)
    from = zone.local(date.year, date.month, date.day, hour)
    create(:time_entry, user: user, time_category: category, work_date: date,
      start_time: from, end_time: from + seconds, clock_in_at: from, clock_out_at: from + seconds,
      entry_method: "clock", status: "completed", approval_status: nil, **attrs)
  end

  it "uses paid 40.00 hours as weekly capacity despite 70 extra elapsed seconds" do
    entries = 5.times.map { |i| shift(sunday + i, 8.hours + 14) }
    expect(entries.sum(&:hours)).to eq(40)
    result = Payroll::WeeklyOvertimeAllocator.call(entries)
    expect(result.fetch(entries.last.id)).to include(regular_hours: 8, overtime_hours: 0)
    expect(entries.last.reload.overtime_status).to eq("none")
    expect(Payroll::BatchBuilder.new(start_date: sunday, end_date: sunday + 6).call[:rows].sum { |r| r[:total_hours] }).to eq(40)
  end

  it "allocates the paid 0.02 overtime when exact elapsed time is only 39.99 hours" do
    entries = 6.times.map { |i| shift(sunday + i, 23_994) }
    expect(entries.sum(&:hours)).to eq(40.02.to_d)
    result = Payroll::WeeklyOvertimeAllocator.call(entries).values
    expect(result.sum { |a| a[:regular_hours].to_d }).to eq(40)
    expect(result.sum { |a| a[:overtime_hours].to_d }).to eq(0.02.to_d)
  end

  it "loads bounded week context with two years of history and preserves untouched nil signatures" do
    current = shift(sunday + 1)
    attributes = current.attributes.except("id").merge("overtime_allocation_signature" => nil, "overtime_status" => "approved")
    TimeEntry.insert_all!(730.times.map { |i| attributes.merge("work_date" => sunday - 730 + i) })
    old = TimeEntry.where(user: user, work_date: sunday - 600).sole
    original = old.attributes.slice("overtime_allocation_signature", "overtime_status", "lock_version", "updated_at")
    loaded = []
    statements = []
    allocations = []
    allow(Payroll::WeeklyOvertimeAllocator).to receive(:call).and_wrap_original do |method, entries, **options|
      allocations << entries.size
      method.call(entries, **options)
    end
    subscriber = ->(_name, _start, _finish, _id, payload) { loaded << payload[:record_count] if payload[:class_name] == "TimeEntry" }
    sql = ->(_name, _start, _finish, _id, payload) { statements << payload[:sql] unless payload[:cached] || payload[:name] == "SCHEMA" }
    ActiveSupport::Notifications.subscribed(subscriber, "instantiation.active_record") do
      ActiveSupport::Notifications.subscribed(sql, "sql.active_record") do
        current.update!(description: "Allocation-unrelated note")
        expect(allocations).to be_empty
        current.update!(end_time: current.end_time + 1.hour)
        current.update!(work_date: sunday - 700)
      end
    end
    RSpec.configuration.reporter.message("Affected-week scale: history=730 allocator_max=#{allocations.max} hydrated=#{loaded.sum} selects=#{statements.grep(/SELECT/).size}")
    expect(allocations.max).to be <= 35
    expect(loaded.sum).to be < 100
    expect(statements.grep(/SELECT/).size).to be < 35
    expect(old.reload.attributes.slice(*original.keys)).to eq(original)
  end

  it "recomputes once for a correction replacing multiple breaks" do
    entry = shift(sunday + 1, 8.hours, break_minutes: 30)
    entry.time_entry_breaks.create!(start_time: zone.parse("2026-10-19 10:00"), end_time: zone.parse("2026-10-19 10:30"))
    expect(Payroll::WeeklyOvertimeAllocator).to receive(:call).at_most(3).times.and_call_original
    Payroll::TimeEntryCorrection.new(entry: entry, actor: admin, reason: "Review exact unpaid break chronology",
      attributes: { breaks: [ { start_time: "10:00", end_time: "10:10" }, { start_time: "12:00", end_time: "12:10" },
        { start_time: "14:00", end_time: "14:10" } ] }).call
    expect(entry.reload.time_entry_breaks.count).to eq(3)
    expect(entry.hours).to eq(7.5)
  end

  it "preloads represented dates instead of probing each frozen payable segment" do
    5.times { |i| shift(sunday + i) }
    Payroll::BatchFinalizer.new(start_date: sunday, end_date: sunday + 6, actor: admin).call
    statements = []
    sql = ->(_name, _start, _finish, _id, payload) { statements << payload[:sql] unless payload[:cached] }
    ActiveSupport::Notifications.subscribed(sql, "sql.active_record") do
      Payroll::BatchBuilder.new(start_date: sunday, end_date: sunday + 6).call
    end
    expect(statements.grep(/SELECT 1 AS one FROM "payroll_batch_entries".*"work_date"/)).to be_empty
  end

  [ nil, "none" ].each do |status|
    it "accounts for allocated OT with legacy #{status.inspect} review status as pending evidence" do
      entries = 6.times.map { |i| shift(sunday + i) }
      entries.last.update_columns(overtime_status: status)
      evidence = Payroll::EmployeePeriodEvidence.new(user: user).call
      expect(evidence[:totals][:pending_hours]).to eq(8)
      expect(evidence[:totals][:denied_hours]).to eq(0)
    end
  end

  it "counts a source entry once even when a summary contains both payable dates" do
    entry = shift(sunday - 1, 4.hours, hour: 22)
    result = Payroll::TimeSummaryBuilder.new(start_date: sunday - 1, end_date: sunday).call
    employee = result[:employees].sole
    expect(employee[:entries_count]).to eq(1)
    expect(employee[:days].flat_map { |day| day[:entry_ids] }.uniq).to eq([ entry.id ])
    expect(employee[:total_hours]).to eq(4)
  end
end
