# frozen_string_literal: true

require "rails_helper"

RSpec.describe "Overtime review correctness and bounded work" do
  include ActiveSupport::Testing::TimeHelpers

  before { travel_to Time.utc(2026, 11, 16, 12) }
  after { travel_back }

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

  def reserve(entry, regular:, overtime:)
    Payroll::ManualAllocationRecorder.new(actor: admin).commit!(entry: entry,
      source_user_uuid: user.payroll_integration_uuid, regular_hours: regular, overtime_hours: overtime,
      external_pay_period_id: "week-membership", external_payroll_item_id: SecureRandom.uuid,
      pay_date: BusinessDate.today.iso8601, reason: "Verified synthetic historical manual payment")
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

  [ :approval, :edit ].each do |action|
    it "does not reclassify a previous-week Saturday paid as OT after a receiving-week #{action}" do
      5.times { |i| shift(sunday - 6 + i) }
      saturday = shift(sunday - 1)
      TimeClockService.approve_overtime(entry: saturday, approved_by: admin)
      allocation = reserve(saturday, regular: 0, overtime: 8)
      travel 1.second
      batch = Payroll::BatchFinalizer.new(start_date: sunday - 7, end_date: sunday - 1, actor: admin).call
      frozen_batch = batch.attributes
      frozen_payment = allocation.attributes
      reviewed = saturday.reload.attributes.slice("overtime_status", "overtime_approved_at", "overtime_allocation_signature")
      expect(reviewed["overtime_status"]).to eq("approved")
      expect(Payroll::WeeklyOvertimeAllocator.weeks(saturday)).to eq([ sunday - 7 ])

      travel 1.second
      receiving = shift(sunday + 1, approval_status: action == :approval ? "pending" : nil)
      if action == :approval
        TimeClockService.approve_entry(entry: receiving, approved_by: admin)
      else
        receiving.update!(end_time: receiving.end_time + 1.hour, clock_out_at: receiving.clock_out_at + 1.hour)
      end
      result = Payroll::BatchBuilder.new(start_date: sunday, end_date: sunday + 6).call
      expect(result[:rows].select { |row| row[:source_time_entry_id] == saturday.id }).to be_empty
      expect(result[:rows]).to include(include(source_time_entry_id: receiving.id, regular_hours: action == :approval ? 8 : 9, overtime_hours: 0))
      expect(saturday.reload.attributes.slice(*reviewed.keys)).to eq(reviewed)
      expect(batch.reload.attributes).to eq(frozen_batch)
      expect(allocation.reload.attributes).to eq(frozen_payment)
    end
  end

  it "still settles a manually paid Saturday that genuinely bridges the receiving week" do
    saturday = shift(sunday - 1)
    allocation = reserve(saturday, regular: 8, overtime: 0)
    travel 1.second
    from = zone.local(2026, 10, 17, 22)
    saturday.update!(start_time: from, clock_in_at: from, end_time: from + 8.hours, clock_out_at: from + 8.hours)
    # Freeze a preceding period after the edit: neither the unchanged source
    # nor its reservation is a late-change seed in the receiving preview.
    batch = Payroll::BatchFinalizer.new(start_date: "2026-10-01", end_date: "2026-10-15", actor: admin).call
    frozen_batch = batch.attributes
    frozen_payment = allocation.attributes
    expect(Payroll::WeeklyOvertimeAllocator.weeks(saturday)).to eq([ sunday - 7, sunday ])
    travel 1.second
    receiving = shift(sunday + 1, approval_status: "pending")
    TimeClockService.approve_entry(entry: receiving, approved_by: admin)
    # Monday starts the requested range, so the Saturday/Sunday bridge enters
    # only through the affected-week manual-allocation settlement join.
    result = Payroll::BatchBuilder.new(start_date: sunday + 1, end_date: sunday + 6).call
    rows = result[:rows].select { |row| row[:source_time_entry_id] == saturday.id }
    expect(rows).to contain_exactly(
      include(work_date: sunday - 1, regular_hours: -6, overtime_hours: 0, source_kind: "correction"),
      include(work_date: sunday, regular_hours: 6, overtime_hours: 0, source_kind: "correction"))
    expect(rows.sum { |row| row[:total_hours] }).to eq(0)
    expect(result[:rows]).to include(include(source_time_entry_id: receiving.id, regular_hours: 8))
    expect(batch.reload.attributes).to eq(frozen_batch)
    expect(allocation.reload.attributes).to eq(frozen_payment)
  end
end
