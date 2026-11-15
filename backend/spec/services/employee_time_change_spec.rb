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

  it "keeps a shift with both decisions pending entirely in time waiting" do
    entry.update!(approval_status: "pending")
    quantities = Payroll::ApprovalHours.new(allocations: {}, legacy_allocations: {},
      projected_allocations: { entry.id => { regular_hours: 2.0, overtime_hours: 4.0 } }).for(entry)
    expect(quantities[:time_waiting_hours]).to eq(6.0)
    expect(quantities[:overtime_waiting_hours]).to eq(0.0)
    expect(quantities.values_at(:time_waiting_hours, :overtime_waiting_hours).sum).to eq(entry.hours.to_f)
  end
  %w[denied approved pending].each do |state|
    it "restores #{state} without inventing an approval decision" do
      entry.update!(approval_status: state, approved_by: state == "pending" ? nil : admin,
                    approved_at: state == "pending" ? nil : Time.current, approval_note: "Prior decision")
      snapshot = described_class.capture(entry)
      entry.update!(end_time: start + 7.hours, clock_out_at: start + 7.hours,
                    approval_status: "pending", original_employee_change: snapshot)
      described_class.reject!(entry: entry, actor: admin, version: entry.lock_version, note: "Keep punches")
      expect(entry.reload.approval_status).to eq(state)
      expect(entry.approval_note).to eq("Prior decision")
      expect(entry.counts_toward_hours?).to eq(state == "approved")
      expect(AuditLog.where(action: "time_entry.#{state}").count).to eq(state == "pending" ? 0 : 1)
    end
  end

  it "preserves all six fractional digits through JSONB and break restoration" do
    precise = start + Rational(123455, 1_000_000)
    entry.update!(clock_in_at: precise)
    entry.time_entry_breaks.create!(start_time: precise + 2.hours, end_time: precise + 2.hours + 10.minutes, duration_minutes: 10)
    entry.update!(original_employee_change: described_class.capture(entry), clock_in_at: start + 1.minute, approval_status: "pending")
    entry.time_entry_breaks.destroy_all
    described_class.reject!(entry: entry.reload, actor: admin, version: entry.lock_version, note: "Keep exact punches")
    expect(entry.reload.clock_in_at.usec).to eq(123455)
    expect(entry.time_entry_breaks.first.start_time.usec).to eq(123455)
  end

  it "keeps the employee fix when the original needs administrator correction" do
    entry.update!(clock_out_at: start + 25.hours, end_time: start + 25.hours)
    snapshot = described_class.capture(entry)
    entry.update!(clock_out_at: start + 8.hours, end_time: start + 8.hours, original_employee_change: snapshot)
    expect(described_class.presentation(entry)).to include("restorable" => false, "restoration_reason" => /original clock-out was missing/)
    expect { described_class.reject!(entry: entry, actor: admin, version: entry.lock_version, note: "Original") }
      .to raise_error(TimeClockService::ClockError, "The original clock-out was missing, so there's nothing to go back to. Approve the employee's fix or edit the shift.")
    expect(entry.reload.hours.to_f).to eq(8)
    expect(entry.original_employee_change).to be_present
    expect(AuditLog.where(action: "time_entry.change_rejected")).to be_empty
  end

  it "marks an original without a clock-out as unrestorable while keeping the fix" do
    snapshot = described_class.capture(entry).merge("clock_out_at" => nil)
    entry.update!(original_employee_change: snapshot, approval_status: "pending")
    expect(described_class.presentation(entry)).to include("restorable" => false, "restoration_reason" => described_class::RESTORATION_ERROR)
    expect { described_class.reject!(entry: entry, actor: admin, version: entry.lock_version, note: "Original") }
      .to raise_error(TimeClockService::ClockError, described_class::RESTORATION_ERROR)
    expect(entry.reload.clock_out_at).to eq(start + 6.hours)
  end

  it "does not capture or reject hand-added shifts, even with an old snapshot" do
    snapshot = described_class.capture(entry)
    entry.update!(entry_method: "manual", approval_status: "pending", original_employee_change: snapshot)
    expect(described_class.capture(entry)).to be_nil
    expect(described_class.presentation(entry)).to be_nil
    expect { described_class.reject!(entry: entry, actor: admin, version: entry.lock_version, note: "Original") }
      .to raise_error(TimeClockService::ClockError, /no pending employee change/)
  end

  it "presents the original date as well as the Guam clock range" do
    entry.update!(original_employee_change: described_class.capture(entry), work_date: Date.new(2026, 11, 15))
    expect(described_class.presentation(entry)).to include("restorable" => true, "restoration_reason" => nil)
    expect(described_class.presentation(entry)["formatted_range"]).to eq("Sat, Nov 14, 7:00 AM–1:00 PM")
  end
  it "records settlement approval history when restoring an approved original" do
    settlement = create(:payroll_settlement_case, source_time_entry_id: entry.id, source_user_id: employee.id, source_user_uuid: employee.payroll_integration_uuid)
    entry.update!(original_employee_change: described_class.capture(entry), approval_status: "pending")
    described_class.reject!(entry: entry, actor: admin, version: entry.lock_version, note: "Keep original")
    event = settlement.payroll_settlement_case_events.find_by!(event_type: "approval_changed")
    expect(event.actor_id).to eq(admin.id)
    expect(event.metadata).to include("decision" => "approved", "note" => "Keep original")
  end
end
