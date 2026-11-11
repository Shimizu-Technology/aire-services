# frozen_string_literal: true

require "rails_helper"

# Leon's Nov 11 approval policy: a supervisor's own clock time always waits
# for an explicit approval, and "Auto-approve ordinary shifts" (off by
# default) approves only an employee's ordinary kiosk or mobile shift.
RSpec.describe TimeClockService, "approval policy", type: :service do
  include ActiveSupport::Testing::TimeHelpers

  let(:zone) { ActiveSupport::TimeZone[described_class::BUSINESS_TIMEZONE] }
  let(:category) { create(:time_category) }
  let(:other_category) { create(:time_category) }
  let(:employee) { create(:user, :employee, first_name: "Ana", time_tracking_enabled: true, kiosk_enabled: true) }
  let(:manager) { create(:user, :manager, time_tracking_enabled: true, kiosk_enabled: true) }
  let(:admin) { create(:user, :admin, time_tracking_enabled: true, kiosk_enabled: true) }
  let(:owner) { create(:user, :owner, time_tracking_enabled: true, kiosk_enabled: true) }

  # Wednesday, April 8 2026, inside the April 1–15 pay period.
  around do |example|
    travel_to(zone.local(2026, 4, 8, 8, 0, 0)) { example.run }
  end

  before do
    [ employee, manager, admin, owner ].each { |user| user.user_time_categories.create!(time_category: category) }
  end

  def turn_on_auto_approval!(max_hours: nil)
    Setting.set(Setting::AUTO_APPROVE_ORDINARY_SHIFTS_KEY, "true")
    Setting.set(Setting::AUTO_APPROVE_MAX_SHIFT_HOURS_KEY, max_hours.to_s) if max_hours
  end

  def shift(user, hours: 8, source: "kiosk", **clock_out)
    described_class.clock_in(user: user, time_category_id: category.id, clock_source: source)
    travel hours.hours
    described_class.clock_out(user: user, **clock_out).reload
  end

  def earlier_week_entries(user, approval_status:)
    # Sunday through Tuesday, 12 hours each: 36 hours before Wednesday.
    [ 5, 6, 7 ].each do |day|
      create(:time_entry, user: user, time_category: category, entry_method: "clock", status: "completed",
        clock_source: "kiosk", work_date: Date.new(2026, 4, day), approval_status: approval_status,
        start_time: zone.local(2000, 1, 1, 6, 0, 0), end_time: zone.local(2000, 1, 1, 18, 0, 0))
    end
  end

  def auto_approval_rows(entry)
    AuditLog.where(action: "time_entry.auto_approved", auditable_type: "TimeEntry", auditable_id: entry.id)
  end

  describe "a supervisor's own clock time" do
    it "goes to the queue for owners, admins and managers, scheduled or not" do
      [ owner, admin, manager ].each do |user|
        entry = shift(user)
        expect(entry).to have_attributes(approval_status: "pending", approval_note: "Clocked in without a schedule | Supervisor's own time")
        expect(entry.counts_toward_hours?).to be(false), user.role
        travel 16.hours
      end

      travel_to(zone.local(2026, 4, 13, 8, 0, 0))
      Schedule.create!(user: manager, work_date: BusinessDate.today, start_time: Time.utc(2000, 1, 1, 8), end_time: Time.utc(2000, 1, 1, 17), created_by: admin)
      scheduled = shift(manager)
      expect(scheduled.schedule).to be_present
      expect(scheduled).to have_attributes(approval_status: "pending", approval_note: "Supervisor's own time")
    end

    it "lets owners and admins approve their own, and managers only while #167's setting is on" do
      owner_entry = shift(owner)
      travel 16.hours
      admin_entry = shift(admin)
      travel 16.hours
      manager_entry = shift(manager)

      described_class.approve_entry(entry: owner_entry, approved_by: owner)
      described_class.approve_entry(entry: admin_entry, approved_by: admin)
      expect([ owner_entry.reload.approved_by, admin_entry.reload.approved_by ]).to eq([ owner, admin ])

      Setting.set(Setting::MANAGERS_CAN_APPROVE_OWN_TIME_KEY, "false")
      expect { described_class.approve_entry(entry: manager_entry, approved_by: manager) }
        .to raise_error(TimeClockService::AuthorizationError, described_class::OWN_TIME_REVIEW_MESSAGE)
      expect(manager_entry.reload.approval_status).to eq("pending")

      Setting.set(Setting::MANAGERS_CAN_APPROVE_OWN_TIME_KEY, "true")
      described_class.approve_entry(entry: manager_entry, approved_by: manager)
      expect(manager_entry.reload).to have_attributes(approval_status: "approved", approved_by_id: manager.id)
    end

    it "is never auto-approved, even when the shift is otherwise ordinary" do
      turn_on_auto_approval!

      [ owner, admin, manager ].each do |user|
        entry = shift(user)
        expect(entry.approval_status).to eq("pending"), user.role
        expect(described_class.ordinary_shift_exceptions(entry)).to eq([ :not_employee, :queued_for_another_reason ])
        expect(auto_approval_rows(entry)).to be_empty
        travel 16.hours
      end
    end
  end

  describe "Auto-approve ordinary shifts" do
    it "is off by default, so an employee's unscheduled ordinary shift stays queued" do
      entry = shift(employee)

      expect(entry).to have_attributes(approval_status: "pending", approval_note: "Clocked in without a schedule", approved_by_id: nil)
      expect(described_class.ordinary_shift_exceptions(entry)).to eq([ :setting_off ])
      expect(auto_approval_rows(entry)).to be_empty
    end

    it "when on, approves an employee's ordinary kiosk or mobile shift at clock-out and records it" do
      turn_on_auto_approval!

      entry = shift(employee)
      expect(entry).to have_attributes(approval_status: "approved", approved_by_id: nil, approval_note: "Auto-approved: ordinary shift",
        overtime_status: "none", hours: 8)
      expect(entry.approved_at).to be_present
      expect(entry).to be_auto_approved
      expect(entry.counts_toward_hours?).to be(true)

      row = auto_approval_rows(entry).sole
      expect(row).to have_attributes(user_id: nil, actor_kind: "system", source: "system", event_category: "approvals", outcome: "succeeded")
      expect(row.metadata).to include("employee_id" => employee.id, "rule" => "ordinary_shift", "hours" => 8.0, "max_shift_hours" => 12.0)
      expect(AuditLogPresenter.new(row).summary).to start_with("System auto-approved")

      travel 16.hours
      expect(shift(employee, source: "mobile")).to be_auto_approved
    end

    it "keeps scheduled shifts as they are today" do
      turn_on_auto_approval!
      Schedule.create!(user: employee, work_date: BusinessDate.today, start_time: Time.utc(2000, 1, 1, 8), end_time: Time.utc(2000, 1, 1, 17), created_by: admin)

      entry = shift(employee)
      expect(entry).to have_attributes(approval_status: nil, approval_note: nil)
      expect(auto_approval_rows(entry)).to be_empty
    end

    it "approves each segment of a category switch, measuring length from the first clock-in" do
      turn_on_auto_approval!(max_hours: 4)
      employee.user_time_categories.create!(time_category: other_category)

      described_class.clock_in(user: employee, time_category_id: category.id, clock_source: "kiosk")
      travel 3.hours
      second = described_class.switch_category(user: employee, time_category_id: other_category.id, clock_source: "kiosk")
      first = employee.time_entries.where.not(id: second.id).sole
      expect(first.reload).to be_auto_approved

      travel 2.hours
      second = described_class.clock_out(user: employee).reload
      expect(second.approval_status).to eq("pending")
      expect(described_class.ordinary_shift_exceptions(second)).to eq([ :too_long ])
    end

    describe "exceptions stay in the queue" do
      before { turn_on_auto_approval! }

      def expect_queued(entry, *exceptions)
        expect(entry.approval_status).to eq("pending")
        expect(entry).not_to be_auto_approved
        expect(described_class.ordinary_shift_exceptions(entry)).to include(*exceptions)
        expect(auto_approval_rows(entry)).to be_empty
      end

      it "a corrected clock-out" do
        described_class.clock_in(user: employee, time_category_id: category.id, clock_source: "kiosk")
        travel 8.hours
        entry = described_class.clock_out(user: employee, corrected_end_time: zone.now.change(hour: 15).iso8601).reload

        expect(entry.approval_note).to include("Employee corrected clock-out time")
        expect_queued(entry, :queued_for_another_reason)
      end

      it "a supervisor clocking the employee out, or an admin-source punch" do
        described_class.clock_in(user: employee, time_category_id: category.id, clock_source: "kiosk")
        travel 8.hours
        expect_queued(described_class.clock_out(user: employee, admin_override_by: admin).reload, :not_self_service)

        travel 16.hours
        expect_queued(shift(employee, source: "admin"), :not_self_service)
      end

      it "an entry edited while it was open" do
        entry = described_class.clock_in(user: employee, time_category_id: category.id, clock_source: "kiosk")
        AuditLog.record!(action: "time_entry.updated", auditable: entry, actor: admin, event_category: "time_tracking")
        travel 8.hours

        expect_queued(described_class.clock_out(user: employee).reload, :edited)
      end

      it "a shift with overtime, which is never auto-approved" do
        earlier_week_entries(employee, approval_status: "approved")

        entry = shift(employee, hours: 6)
        expect(entry.overtime_status).to eq("pending")
        expect_queued(entry, :overtime)
      end

      it "a shift that would be overtime once earlier waiting shifts are approved" do
        earlier_week_entries(employee, approval_status: "pending")

        entry = shift(employee, hours: 6)
        expect(entry.overtime_status).to eq("none")
        expect_queued(entry, :overtime)
      end

      it "a shift at or over the length limit" do
        Setting.set(Setting::AUTO_APPROVE_MAX_SHIFT_HOURS_KEY, "8")

        expect_queued(shift(employee, hours: 8), :too_long)
        travel 16.hours
        expect(shift(employee, hours: 7.5)).to be_auto_approved
      end

      it "a missed clock-out closed by the system" do
        described_class.clock_in(user: employee, time_category_id: category.id, clock_source: "kiosk")
        travel 13.hours
        described_class.flag_stale_entries

        entry = employee.time_entries.sole
        expect(entry.approval_note).to include("Auto-closed")
        expect_queued(entry, :not_self_service, :queued_for_another_reason)
      end

      it "late hours in a pay period AIRE already finalized" do
        PayrollBatch.create!(public_id: "AIRE-PAY-APRIL-A", start_date: Date.new(2026, 4, 1), end_date: Date.new(2026, 4, 15),
          cutoff_at: 1.hour.ago, finalized_at: 1.hour.ago, checksum: "c" * 64)

        expect_queued(shift(employee), :late_hours)
      end

      it "a shift across the pay period boundary" do
        travel_to(zone.local(2026, 4, 15, 20, 0, 0))

        expect_queued(shift(employee, hours: 6), :crosses_period)
      end

      it "a shift during which a payroll lock passed" do
        PayrollBatch.create!(public_id: "AIRE-PAY-MARCH-B", start_date: Date.new(2026, 3, 16), end_date: Date.new(2026, 3, 31),
          cutoff_at: 2.hours.from_now, finalized_at: 2.hours.from_now, checksum: "d" * 64)

        expect_queued(shift(employee), :crosses_period)
      end

      it "an entry with no work category" do
        entry = shift(employee)
        entry.update_columns(time_category_id: nil)

        expect(described_class.ordinary_shift_exceptions(entry)).to include(:no_category)
      end
    end
  end

  describe "payroll batches" do
    it "treat an auto-approved shift as approved and leave a queued one out" do
      queued = shift(employee)
      travel 16.hours
      turn_on_auto_approval!
      approved = shift(employee)

      rows = Payroll::BatchBuilder.new(start_date: Date.new(2026, 4, 1), end_date: Date.new(2026, 4, 15)).call[:rows]
      expect(rows.map { |row| row[:source_time_entry_id] }).to include(approved.id)
      expect(rows.map { |row| row[:source_time_entry_id] }).not_to include(queued.id)
    end
  end
end
