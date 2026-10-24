# frozen_string_literal: true

require "rails_helper"

RSpec.describe "Guam payable intervals and affected overtime review" do
  let(:user) { create(:user, :employee) }
  let(:admin) { create(:user, :admin) }
  let(:category) { create(:time_category) }
  let(:zone) { ActiveSupport::TimeZone["Pacific/Guam"] }
  let(:sunday) { Date.new(2026, 10, 18) }

  def shift(date, start_hour, hours, **attrs)
    start = zone.local(date.year, date.month, date.day, start_hour)
    create(:time_entry, user: user, time_category: category, work_date: date,
      entry_method: "clock", status: "completed", approval_status: nil,
      start_time: start, end_time: start + hours.hours,
      clock_in_at: start, clock_out_at: start + hours.hours, **attrs)
  end

  def allocation(entry)
    Payroll::WeeklyOvertimeAllocator.call(TimeEntry.where(user: user).select(&:counts_toward_hours?)).fetch(entry.id)
  end

  it "splits Saturday at Sunday midnight after 38 hours, preserving the nominal date" do
    4.times { |i| shift(sunday - 6 + i, 8, 9.5) }
    overnight = shift(sunday - 1, 22, 4)
    expect(allocation(overnight)).to include(regular_hours: 4, overtime_hours: 0)
    expect(allocation(overnight).fetch(:segments).map { |s| [ s[:work_date], s[:regular_hours] ] })
      .to eq([ [ sunday - 1, 2 ], [ sunday, 2 ] ])
    expect(overnight.reload.work_date).to eq(sunday - 1)
  end

  it "subtracts only each segment's intersection with a spanning break" do
    overnight = shift(sunday - 1, 22, 4, break_minutes: 60)
    overnight.time_entry_breaks.create!(start_time: zone.parse("2026-10-17 23:30"), end_time: zone.parse("2026-10-18 00:30"))
    expect(allocation(overnight).fetch(:segments).map { |s| s[:total_hours] }).to eq([ 1.5, 1.5 ])
  end

  it "holds an overnight aggregate break without observed placement" do
    overnight = shift(sunday - 1, 22, 4, break_minutes: 60)
    expect(allocation(overnight)).to include(hold_reason: "unplaced_overnight_break")
  end

  it "captures break-only changes at the DB clock and reconstructs the cutoff break" do
    overnight = shift(sunday - 1, 22, 4, break_minutes: 60)
    brk = overnight.time_entry_breaks.create!(start_time: zone.parse("2026-10-17 23:30"), end_time: zone.parse("2026-10-18 00:30"))
    cutoff = ApplicationRecord.connection.select_value("SELECT clock_timestamp()")
    brk.update!(start_time: zone.parse("2026-10-18 00:30"), end_time: zone.parse("2026-10-18 01:30"))
    state = Payroll::TimeEntryRevisionLedger.new(cutoff_at: cutoff).entries_for_ids([ overnight.id ]).sole
    expect(state.time_entry_breaks.sole.start_time).to eq(zone.parse("2026-10-17 23:30"))
    expect(Payroll::WeeklyOvertimeAllocator.call([ state ]).fetch(state.id).fetch(:segments).map { |s| s[:total_hours] }).to eq([ 1.5, 1.5 ])
    brk.destroy!
    expect(Payroll::TimeEntryRevisionLedger.new(cutoff_at: ApplicationRecord.connection.select_value("SELECT clock_timestamp()"))
      .entries_for_ids([ overnight.id ]).sole.time_entry_breaks).to be_empty
  end

  it "moves Friday into the queue after Sunday approval and preserves unchanged review evidence" do
    earlier = shift(sunday, 8, 8, approval_status: "pending")
    weekdays = 5.times.map { |i| shift(sunday + 1 + i, 8, 8) }
    friday = weekdays.last
    TimeClockService.approve_entry(entry: earlier, approved_by: admin)
    expect(friday.reload.overtime_status).to eq("pending")
    TimeClockService.approve_overtime(entry: friday, approved_by: admin)
    reviewed_at = friday.reload.overtime_approved_at
    weekdays.first.update!(description: "Unrelated note")
    expect(friday.reload).to have_attributes(overtime_status: "approved", overtime_approved_at: reviewed_at)
    earlier.update!(approval_status: "denied")
    expect(friday.reload).to have_attributes(overtime_status: "none", overtime_approved_at: nil)
  end
  [ [ "23:00", "23:30", [ 1.5, 2.0 ] ], [ "00:30", "01:00", [ 2.0, 1.5 ] ] ].each do |from, to, totals|
    it "places the #{from} unpaid break wholly on its observed side" do
      overnight = shift(sunday - 1, 22, 4, break_minutes: 30)
      date = from.start_with?("23") ? sunday - 1 : sunday
      overnight.time_entry_breaks.create!(start_time: zone.parse("#{date} #{from}"), end_time: zone.parse("#{date} #{to}"))
      expect(allocation(overnight).fetch(:segments).map { |segment| segment[:total_hours] }).to eq(totals)
    end
  end

  it "includes an overlapping Saturday entry in a Sunday-only report and summary" do
    shift(sunday - 1, 22, 4)
    report = Payroll::HoursReportBuilder.new(start_date: sunday.to_s, end_date: sunday.to_s, user_id: user.id).call
    expect(report[:summary]).to include(total_hours: 2, regular_hours: 2, overtime_hours: 0)
    expect(report[:employees].sole[:days].sole[:work_date]).to eq(sunday.to_s)
    summary = Payroll::TimeSummaryBuilder.new(start_date: sunday.to_s, end_date: sunday.to_s).call
    expect(summary[:employees].sole).to include(total_hours: 2, regular_hours: 2, overtime_hours: 0)
  end

  it "consumes receiving-week capacity and puts the later entry into review" do
    shift(sunday - 1, 22, 4)
    4.times { |i| shift(sunday + i, 8, 9.5) }
    friday = shift(sunday + 5, 8, 2)
    expect(allocation(friday)).to include(regular_hours: 0, overtime_hours: 2)
    expect(friday.reload.overtime_status).to eq("pending")
    builder = Payroll::BatchBuilder.new(start_date: sunday.to_s, end_date: (sunday + 6).to_s).call
    expect(builder[:rows].select { |row| row[:source_time_entry_id] == friday.id }).to be_empty
    expect(builder[:exclusions]).to include(include(source_time_entry_id: friday.id, reason: "pending_overtime"))
    TimeClockService.deny_overtime(entry: friday, denied_by: admin, note: "Not authorized")
    expect(Payroll::BatchBuilder.new(start_date: sunday.to_s, end_date: (sunday + 6).to_s).call[:exclusions])
      .to include(include(source_time_entry_id: friday.id, reason: "denied_overtime"))
  end

  it "exports adjacent-period segments once under stable payable dates" do
    # October 31 is Saturday and crosses a semimonthly period boundary.
    overnight = shift(Date.new(2026, 10, 31), 22, 4)
    first = Payroll::BatchFinalizer.new(start_date: "2026-10-16", end_date: "2026-10-31", actor: admin).call
    expect(first.payroll_batch_entries.where(source_time_entry_id: overnight.id).pluck(:work_date, :total_hours))
      .to eq([ [ Date.new(2026, 10, 31), 2 ] ])
    second = Payroll::BatchBuilder.new(start_date: "2026-11-01", end_date: "2026-11-15").call
    expect(second[:rows].map { |row| [ row[:source_time_entry_id], row[:work_date], row[:total_hours] ] })
      .to eq([ [ overnight.id, Date.new(2026, 11, 1), 2 ] ])
  end

  it "recomputes both weeks after moving earlier time and does not reset an unchanged sibling" do
    earlier = shift(sunday, 8, 8)
    weekdays = 5.times.map { |i| shift(sunday + i + 1, 8, 8) }
    friday = weekdays.last
    TimeClockService.approve_overtime(entry: friday, approved_by: admin)
    earlier.update!(work_date: sunday + 7)
    expect(friday.reload).to have_attributes(overtime_status: "none", overtime_approved_at: nil)
    next_week = 5.times.map { |i| shift(sunday + 8 + i, 8, 8) }.last
    expect(next_week.reload.overtime_status).to eq("pending")
    earlier.destroy!
    expect(next_week.reload.overtime_status).to eq("none")
  end

  it "preserves decimal-second capacity and reconciles each rounded segment to its approved total" do
    entry = shift(sunday - 1, 23, 2)
    entry.update_columns(start_time: zone.parse("2026-10-17 23:00:00.123456"), clock_in_at: zone.parse("2026-10-17 23:00:00.123456"))
    split = allocation(entry)
    expect(split[:segments].sum { |segment| segment[:total_hours].to_d }).to eq(entry.reload.hours)
    expect(split[:segments].all? { |segment| segment[:regular_hours] >= 0 && segment[:overtime_hours] >= 0 }).to be(true)
  end
  it "closes a category at midnight and starts the next category in the receiving week" do
    other = create(:time_category)
    user.assigned_time_categories << [ category, other ]
    schedule = Schedule.create!(user: user, work_date: sunday - 1, start_time: "08:00", end_time: "23:00")
    from = zone.parse("2026-10-17 22:00")
    active = create(:time_entry, user: user, time_category: category, work_date: sunday - 1,
      status: "clocked_in", entry_method: "clock", start_time: from, clock_in_at: from, end_time: nil,
      clock_out_at: nil, hours: 0, schedule: schedule)
    allow(Time).to receive(:current).and_return(zone.parse("2026-10-18 00:00"))
    next_entry = TimeClockService.switch_category(user: user, time_category_id: other.id, admin_override_by: admin)
    allow(Time).to receive(:current).and_return(zone.parse("2026-10-18 02:00"))
    TimeClockService.clock_out(user: user)
    expect(active.reload).to have_attributes(work_date: sunday - 1, hours: 2, time_category_id: category.id)
    expect(next_entry.reload).to have_attributes(work_date: sunday, hours: 2, time_category_id: other.id)
    expect(allocation(active)).to include(regular_hours: 2, overtime_hours: 0)
    expect(allocation(next_entry)).to include(regular_hours: 2, overtime_hours: 0)
  end

  it "invalidates changed reviewed OT after a reduction and a Payroll correction, while retaining frozen evidence" do
    earlier = shift(sunday, 8, 8)
    weekdays = 5.times.map { |i| shift(sunday + 1 + i, 8, 8) }
    friday = weekdays.last
    TimeClockService.approve_overtime(entry: friday, approved_by: admin)
    earlier.update!(end_time: zone.parse("2026-10-18 12:00"), clock_out_at: zone.parse("2026-10-18 12:00"))
    expect(allocation(friday)).to include(regular_hours: 4, overtime_hours: 4)
    expect(friday.reload).to have_attributes(overtime_status: "pending", overtime_approved_at: nil)
    TimeClockService.deny_overtime(entry: friday, denied_by: admin, note: "Review quantity")
    corrected_category = create(:time_category)
    user.assigned_time_categories << corrected_category
    Payroll::TimeEntryCorrection.new(entry: earlier, attributes: { time_category_id: corrected_category.id },
      actor: admin, reason: "Correct category").call
    expect(friday.reload).to have_attributes(overtime_status: "none", overtime_approved_at: nil)
    TimeClockService.approve_entry(entry: earlier, approved_by: admin)
    expect(friday.reload.overtime_status).to eq("pending")
  end
  it "holds both linked weeks when an overnight break cannot be placed" do
    overnight = shift(sunday - 1, 22, 4, break_minutes: 60)
    following = shift(sunday + 1, 8, 8)
    allocations = Payroll::WeeklyOvertimeAllocator.call([ overnight, following ])
    expect(allocations.fetch(following.id)).to include(hold_reason: "unresolved_week_interval")
    batch = Payroll::BatchBuilder.new(start_date: sunday.to_s, end_date: (sunday + 6).to_s).call
    expect(batch[:rows]).to be_empty
    expect(batch[:exclusions]).to include(include(source_time_entry_id: following.id, reason: "pending_approval"))
  end

  it "retains a frozen regular line until redistributed overtime is approved" do
    earlier = shift(sunday, 8, 8, approval_status: "pending")
    weekdays = 5.times.map { |i| shift(sunday + i + 1, 8, 8) }
    friday = weekdays.last
    first = Payroll::BatchFinalizer.new(start_date: sunday.to_s, end_date: (sunday + 6).to_s, actor: admin).call
    old_bytes = [ first.reload.payload.to_json, first.checksum ]
    TimeClockService.approve_entry(entry: earlier, approved_by: admin)
    pending = Payroll::BatchBuilder.new(start_date: (sunday + 7).to_s, end_date: (sunday + 13).to_s).call
    expect(pending[:rows].select { |row| row[:source_time_entry_id] == friday.id }).to be_empty
    expect(pending[:rows].sum { |row| row[:total_hours] }).to eq(8)
    TimeClockService.approve_overtime(entry: friday.reload, approved_by: admin)
    reviewed = Payroll::BatchBuilder.new(start_date: (sunday + 7).to_s, end_date: (sunday + 13).to_s).call
    expect(reviewed[:rows]).to include(include(source_time_entry_id: friday.id, regular_hours: -8, overtime_hours: 8, total_hours: 0))
    expect([ first.reload.payload.to_json, first.checksum ]).to eq(old_bytes)
  end
  it "builds a delayed published cutoff from its observed break positions rather than live breaks" do
    overnight = shift(sunday - 1, 22, 4, break_minutes: 60)
    brk = overnight.time_entry_breaks.create!(start_time: zone.parse("2026-10-17 23:30"), end_time: zone.parse("2026-10-18 00:30"))
    cutoff = ApplicationRecord.connection.select_value("SELECT clock_timestamp()")
    cutoff_date = cutoff.in_time_zone(zone).to_date
    period_start = cutoff_date.day <= 15 ? cutoff_date.beginning_of_month : cutoff_date.change(day: 16)
    period_end = period_start.day == 1 ? period_start.change(day: 15) : period_start.end_of_month
    # The source can be historical carryover; use a published destination
    # containing the source's nominal date for this probe.
    period = PayrollCalendarPeriod.create!(external_pay_period_id: SecureRandom.uuid,
      start_date: Date.new(2026, 10, 16), end_date: Date.new(2026, 10, 31), pay_date: [ Date.new(2026, 11, 7), period_end + 14 ].max,
      cutoff_at: cutoff, schedule_version: 1, schema_version: "2.0", cutoff_rule: "after_previous_regular_payday", cutoff_days: 1,
      previous_regular_pay_date: cutoff_date - 1, publication_id: SecureRandom.uuid, request_checksum: "a" * 64)
    brk.update!(start_time: zone.parse("2026-10-18 00:30"), end_time: zone.parse("2026-10-18 01:30"))
    result = Payroll::BatchBuilder.new(start_date: period.start_date.to_s, end_date: period.end_date.to_s,
      cutoff_at: cutoff, calendar_period: period).call
    expect(result[:rows].select { |row| row[:source_time_entry_id] == overnight.id }.map { |row| [ row[:work_date], row[:total_hours] ] })
      .to eq([ [ sunday - 1, 1.5 ], [ sunday, 1.5 ] ])
    expect(result[:payload][:allocation_contract_version]).to eq("guam_intervals_v1")
  end
  it "records a start-only break edit and recomputes its observed duration" do
    overnight = shift(sunday - 1, 22, 4, break_minutes: 60)
    brk = overnight.time_entry_breaks.create!(start_time: zone.parse("2026-10-17 23:30"), end_time: zone.parse("2026-10-18 00:30"))
    brk.update!(start_time: zone.parse("2026-10-18 00:00"))
    expect(brk.reload.duration_minutes).to eq(30)
    expect(overnight.reload.lock_version).to be > 1
    expect(allocation(overnight)).to include(hold_reason: "unplaced_overnight_break")
  end
end
