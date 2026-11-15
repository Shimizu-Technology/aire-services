# frozen_string_literal: true

require "rails_helper"

RSpec.describe EmployeeTimeChange do
  let(:employee) { create(:user, :employee) }
  let(:admin) { create(:user, :admin) }
  let(:category) { create(:time_category) }
  let(:zone) { ActiveSupport::TimeZone["Pacific/Guam"] }
  let(:start) { zone.local(2026, 11, 14, 7) }
  let(:entry) { create(:time_entry, user: employee, time_category: category, entry_method: "clock", status: "completed", start_time: start, end_time: start + 6.hours, clock_in_at: start, clock_out_at: start + 6.hours, approval_status: "approved") }

  it "restores exact breaks and never restores an old overtime approval" do
    entry.time_entry_breaks.create!(start_time: start + 2.hours, end_time: start + 2.hours + 10.minutes, duration_minutes: 10)
    snapshot = described_class.capture(entry)
    entry.update!(end_time: start + 7.hours, clock_out_at: start + 7.hours, approval_status: "pending", original_employee_change: snapshot)
    entry.time_entry_breaks.destroy_all
    described_class.reject!(entry: entry, actor: admin, version: entry.lock_version, note: "Use original punches")
    expect(entry.reload.clock_out_at).to eq(start + 6.hours)
    expect(entry.time_entry_breaks.count).to eq(1)
    expect(entry.time_entry_breaks.first.start_time).to eq(start + 2.hours)
    expect(entry.overtime_approved_by).to be_nil
    expect(entry.approval_status).to eq("approved")
  end

  it "splits pending projected overtime into additive approval quantities" do
    entry.update!(approval_status: "pending")
    quantities = Payroll::ApprovalHours.new(allocations: {}, legacy_allocations: {},
      projected_allocations: { entry.id => { regular_hours: 2.0, overtime_hours: 4.0 } }).for(entry)
    expect(quantities[:time_waiting_hours]).to eq(2.0)
    expect(quantities[:overtime_waiting_hours]).to eq(4.0)
    expect(quantities.values_at(:time_waiting_hours, :overtime_waiting_hours).sum).to eq(entry.hours.to_f)
  end
end
