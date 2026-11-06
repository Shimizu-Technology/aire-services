# frozen_string_literal: true

require "rails_helper"

RSpec.describe "Forgotten clock correction hold", type: :service do
  include ActiveSupport::Testing::TimeHelpers
  let(:admin) { create(:user, :admin) }
  let(:employee) { create(:user, :employee, kiosk_enabled: true, time_tracking_enabled: true, kiosk_pin: "123456") }
  let(:category) { create(:time_category) }
  let(:now) { Time.utc(2026, 10, 24, 2) }
  before do
    travel_to now
    employee.user_time_categories.create!(time_category: category)
  end
  after { travel_back }

  [ 24, 26, 49 ].each do |elapsed|
    [ :personal, :kiosk, :stale ].each do |path|
      it "holds a #{elapsed}h #{path} closure without wrapping or paying elapsed time" do
        start = now - elapsed.hours
        entry = create(:time_entry, user: employee, time_category: category, work_date: start.in_time_zone("Pacific/Guam").to_date,
          entry_method: "clock", status: "clocked_in", start_time: start, clock_in_at: start,
          end_time: nil, clock_out_at: nil, hours: 0, approval_status: "approved")
        if path == :stale
          TimeClockService.flag_stale_entries
        elsif path == :kiosk
          AireKioskService.clock_out(kiosk_access_token: AireKioskAccessToken.issue_for(admin),
            kiosk_token: AireKioskToken.issue_for(employee))
        else
          TimeClockService.clock_out(user: employee)
        end
        expect(entry.reload).to have_attributes(status: "completed", clock_in_at: start, clock_out_at: now,
          hours: 0, approval_status: "pending")
        expect(entry.approval_note).to match(/needs administrator correction/i)
        expect(entry.counts_toward_hours?).to be(false)
        expect { TimeClockService.approve_entry(entry: entry, approved_by: admin) }
          .to raise_error(TimeClockService::ClockError, /administrator correction/i)
        expect(entry.reload.approval_status).to eq("pending")
        report = Payroll::HoursReportBuilder.new(start_date: entry.work_date, end_date: entry.work_date)
        flags = report.send(:build_entry_quality_flags, [ entry ])
        expect(flags[entry.id]).to include("long_shift")
      end
    end
  end

  it "keeps a sub-24h overnight span and nominal corrected stop separate from the actual punch" do
    start = now - 23.hours - 59.minutes
    entry = create(:time_entry, user: employee, time_category: category, work_date: start.in_time_zone("Pacific/Guam").to_date,
      entry_method: "clock", status: "clocked_in", start_time: start, clock_in_at: start, end_time: nil, clock_out_at: nil, hours: 0)
    TimeClockService.clock_out(user: employee, corrected_end_time: (now - 1.hour).in_time_zone("Pacific/Guam").iso8601)
    expect(entry.reload.hours).to eq(22.98)
    expect(entry.clock_out_at).to eq(now)
    expect(entry.needs_administrator_correction?).to be(false)
  end

  it "holds corrected personal clock-out too when the actual forgotten session is over 24h" do
    start = now - 26.hours
    entry = create(:time_entry, user: employee, time_category: category, work_date: start.in_time_zone("Pacific/Guam").to_date,
      entry_method: "clock", status: "clocked_in", start_time: start, clock_in_at: start, end_time: nil, clock_out_at: nil, hours: 0)
    TimeClockService.clock_out(user: employee, corrected_end_time: (start + 8.hours).in_time_zone("Pacific/Guam").iso8601)
    expect(entry.reload).to have_attributes(hours: 0, clock_in_at: start, clock_out_at: now, approval_status: "pending")
    expect { TimeClockService.approve_entry(entry: entry, approved_by: admin) }
      .to raise_error(TimeClockService::ClockError, /administrator correction/i)
  end

  it "rejects exactly 24h in explicit administrator closure too" do
    start = now - 24.hours
    entry = create(:time_entry, user: employee, time_category: category, work_date: start.in_time_zone("Pacific/Guam").to_date,
      entry_method: "clock", status: "clocked_in", start_time: start, clock_in_at: start, end_time: nil, clock_out_at: nil, hours: 0)
    expect {
      TimeEntryReviewCorrection.call(entry: entry, actor: admin, action: "end_clock", reason: "Confirmed stop",
        attributes: { expected_version: entry.lock_version, stop_date: now.in_time_zone("Pacific/Guam").to_date.to_s,
          end_time: "12:00", time_category_id: category.id })
    }.to raise_error(TimeEntryReviewCorrection::CorrectionError, /24 hours/)
  end
end
