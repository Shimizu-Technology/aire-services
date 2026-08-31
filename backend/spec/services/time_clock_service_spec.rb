# frozen_string_literal: true

require "rails_helper"

RSpec.describe TimeClockService, type: :service do
  include ActiveSupport::Testing::TimeHelpers

  let(:user) { create(:user, :employee, time_tracking_enabled: true, kiosk_enabled: true) }
  let(:guam_zone) { ActiveSupport::TimeZone[described_class::BUSINESS_TIMEZONE] }
  let(:frozen_time) { guam_zone.local(2026, 4, 2, 9, 0, 0) }

  around do |example|
    travel_to(frozen_time) { example.run }
  end

  describe ".clock_in" do
    it "rejects disabled time tracking without creating an entry" do
      Setting.set("schedule_required_for_clock_in", "false")
      allow(user).to receive(:time_tracking_enabled?).and_return(false)

      expect {
        described_class.clock_in(user: user)
      }.to raise_error(TimeClockService::ClockError, /Time tracking is not enabled/i)

      expect(user.time_entries).to be_empty
      expect(user.kiosk_enabled?).to be(true)
    end

    it "reports missing categories in the current status" do
      Setting.set("schedule_required_for_clock_in", "false")

      status = described_class.current_status(user: user)

      expect(status[:can_clock_in]).to be(false)
      expect(status[:clock_in_blocked_reason]).to eq("categories_missing")
    end

    it "allows clock-in without a schedule when the schedule requirement is disabled" do
      Setting.set("schedule_required_for_clock_in", "false")
      time_category = create(:time_category)
      UserTimeCategory.create!(user: user, time_category: time_category)

      entry = described_class.clock_in(user: user, time_category_id: time_category.id)

      expect(entry).to be_persisted
      expect(entry.schedule).to be_nil
      expect(entry.status).to eq("clocked_in")
    end

    it "blocks clock-in without a schedule when the schedule requirement is enabled" do
      Setting.set("schedule_required_for_clock_in", "true")

      expect {
        described_class.clock_in(user: user)
      }.to raise_error(TimeClockService::ClockError, /No shift scheduled for today/)
    end

    it "includes the schedule requirement flag in the current status payload" do
      Setting.set("schedule_required_for_clock_in", "true")
      user.user_time_categories.create!(time_category: create(:time_category))

      status = described_class.current_status(user: user)

      expect(status[:schedule_required_for_clock_in]).to be(true)
      expect(status[:clock_in_blocked_reason]).to eq("no_schedule")
    end

    it "blocks employees with no assigned categories from clocking in" do
      Setting.set("schedule_required_for_clock_in", "false")

      expect {
        described_class.clock_in(user: user)
      }.to raise_error(TimeClockService::ClockError, /Choose a work category/)
    end

    it "automatically selects the only assigned category" do
      Setting.set("schedule_required_for_clock_in", "false")
      assigned_category = create(:time_category)
      UserTimeCategory.create!(user: user, time_category: assigned_category)

      entry = described_class.clock_in(user: user)

      expect(entry.time_category).to eq(assigned_category)
    end

    it "requires a choice when more than one category is assigned" do
      Setting.set("schedule_required_for_clock_in", "false")
      create_list(:time_category, 2).each do |category|
        UserTimeCategory.create!(user: user, time_category: category)
      end

      expect {
        described_class.clock_in(user: user)
      }.to raise_error(TimeClockService::ClockError, /Choose a work category/)
    end

    it "blocks employees from clocking in with an unassigned category" do
      Setting.set("schedule_required_for_clock_in", "false")
      assigned_category = create(:time_category)
      unassigned_category = create(:time_category)
      UserTimeCategory.create!(user: user, time_category: assigned_category)

      expect {
        described_class.clock_in(user: user, time_category_id: unassigned_category.id)
      }.to raise_error(TimeClockService::ClockError, /not assigned/)
    end

    it "does not let an admin override an employee's category assignment" do
      Setting.set("schedule_required_for_clock_in", "false")
      admin = create(:user, :admin)
      unassigned_category = create(:time_category)

      expect do
        described_class.clock_in(
          user: user,
          admin_override_by: admin,
          time_category_id: unassigned_category.id
        )
      end.to raise_error(TimeClockService::ClockError, /not assigned/)
    end

    it "auto-selects the employee's only assigned category for an admin override" do
      Setting.set("schedule_required_for_clock_in", "false")
      admin = create(:user, :admin)
      assigned_category = create(:time_category)
      UserTimeCategory.create!(user: user, time_category: assigned_category)

      entry = described_class.clock_in(user: user, admin_override_by: admin)

      expect(entry).to have_attributes(
        time_category_id: assigned_category.id,
        admin_override: true,
        status: "clocked_in"
      )
    end

    it "requires a nearby location for mobile clock-in when geofencing is enabled" do
      Setting.set("schedule_required_for_clock_in", "false")
      Setting.set("clock_in_location_enforced", "true")
      time_category = create(:time_category)
      UserTimeCategory.create!(user: user, time_category: time_category)

      expect {
        described_class.clock_in(
          user: user,
          time_category_id: time_category.id,
          clock_source: "mobile",
          location: { latitude: 13.55, longitude: 144.9, accuracy_meters: 10 }
        )
      }.to raise_error(TimeClockService::ClockError, /only allowed while you are at AIRE Services Guam/i)
    end

    it "allows a nearby mobile clock-in when the location is within the configured radius" do
      Setting.set("schedule_required_for_clock_in", "false")
      Setting.set("clock_in_location_enforced", "true")
      time_category = create(:time_category)
      UserTimeCategory.create!(user: user, time_category: time_category)

      entry = described_class.clock_in(
        user: user,
        time_category_id: time_category.id,
        clock_source: "mobile",
        location: { latitude: 13.4692, longitude: 144.7991, accuracy_meters: 20 }
      )

      expect(entry).to be_persisted
      expect(entry.status).to eq("clocked_in")
    end
  end

  describe ".clock_out" do
    it "marks unscheduled employee clock entries as pending on clock-out" do
      Setting.set("schedule_required_for_clock_in", "false")
      time_category = create(:time_category)
      UserTimeCategory.create!(user: user, time_category: time_category)

      described_class.clock_in(user: user, time_category_id: time_category.id)

      travel 2.hours
      entry = described_class.clock_out(user: user)

      expect(entry.status).to eq("completed")
      expect(entry.schedule).to be_nil
      expect(entry.approval_status).to eq("pending")
      expect(entry.approval_note).to eq("Clocked in without a schedule")
    end

    it "preserves both unscheduled and corrected clock-out notes" do
      Setting.set("schedule_required_for_clock_in", "false")
      user.user_time_categories.create!(time_category: create(:time_category))

      described_class.clock_in(user: user)

      travel 2.hours
      entry = described_class.clock_out(user: user, corrected_end_time: "2026-04-02T10:30:00")

      expect(entry.approval_status).to eq("pending")
      expect(entry.approval_note).to eq("Clocked in without a schedule | Employee corrected clock-out time to 10:30 AM")
    end

    it "does not mark unscheduled admin clock entries as pending on clock-out" do
      Setting.set("schedule_required_for_clock_in", "false")
      admin = create(:user, :admin, time_tracking_enabled: true, kiosk_enabled: true)
      admin.user_time_categories.create!(time_category: create(:time_category))

      described_class.clock_in(user: admin)

      travel 2.hours
      entry = described_class.clock_out(user: admin)

      expect(entry.status).to eq("completed")
      expect(entry.schedule).to be_nil
      expect(entry.approval_status).to be_nil
      expect(entry.approval_note).to be_nil
    end

    it "completes clock entries without embedding payroll rates" do
      Setting.set("schedule_required_for_clock_in", "false")
      time_category = create(:time_category, hourly_rate_cents: 3000)
      UserTimeCategory.create!(user: user, time_category: time_category)
      entry = described_class.clock_in(user: user, time_category_id: time_category.id)
      expect(entry.effective_rate_cents_snapshot).to be_nil

      travel 2.hours
      described_class.clock_out(user: user)

      entry.reload
      expect(entry.status).to eq("completed")
      expect(entry.effective_rate_cents_snapshot).to be_nil
      expect(entry).not_to respond_to(:effective_rate)
    end

    it "allows clock-out after midnight for an overnight shift" do
      Setting.set("schedule_required_for_clock_in", "false")
      time_category = create(:time_category)
      UserTimeCategory.create!(user: user, time_category: time_category)
      overnight_start = guam_zone.local(2026, 4, 2, 23, 30, 0)

      travel_to(overnight_start)
      described_class.clock_in(user: user, time_category_id: time_category.id)

      travel_to(overnight_start + 2.hours)
      entry = described_class.clock_out(user: user)

      expect(entry).to be_persisted
      expect(entry.status).to eq("completed")
      expect(entry.hours).to eq(2.0)
    end

    it "repairs a legacy categoryless active entry when exactly one category is assigned" do
      Setting.set("schedule_required_for_clock_in", "false")
      assigned_category = create(:time_category)
      UserTimeCategory.create!(user: user, time_category: assigned_category)
      entry = create(
        :time_entry,
        user: user,
        time_category: nil,
        entry_method: "clock",
        status: "clocked_in",
        start_time: frozen_time,
        clock_in_at: frozen_time,
        end_time: nil,
        clock_out_at: nil,
        hours: 0
      )

      travel 2.hours
      described_class.clock_out(user: user)

      expect(entry.reload.time_category).to eq(assigned_category)
      expect(entry.status).to eq("completed")
      repair_audit = AuditLog.find_by!(auditable: entry, action: "time_entry.category_auto_assigned")
      expect(repair_audit.metadata).to include(
        "previous_time_category_id" => nil,
        "assigned_time_category_id" => assigned_category.id,
        "trigger_action" => "time_entry.clocked_out"
      )
    end

    it "does not guess a category for a legacy categoryless active entry" do
      Setting.set("schedule_required_for_clock_in", "false")
      create_list(:time_category, 2).each do |category|
        UserTimeCategory.create!(user: user, time_category: category)
      end
      entry = create(
        :time_entry,
        user: user,
        time_category: nil,
        entry_method: "clock",
        status: "clocked_in",
        start_time: frozen_time,
        clock_in_at: frozen_time,
        end_time: nil,
        clock_out_at: nil,
        hours: 0
      )

      travel 2.hours

      expect {
        described_class.clock_out(user: user)
      }.to raise_error(TimeClockService::ClockError, /Choose a work category before clocking out/)
      expect(entry.reload.status).to eq("clocked_in")
    end
  end

  describe ".flag_stale_entries" do
    it "repairs a legacy categoryless entry when the employee has one assigned category" do
      assigned_category = create(:time_category)
      UserTimeCategory.create!(user: user, time_category: assigned_category)
      entry = create(
        :time_entry,
        user: user,
        time_category: nil,
        entry_method: "clock",
        status: "clocked_in",
        start_time: frozen_time - 13.hours,
        clock_in_at: frozen_time - 13.hours,
        end_time: nil,
        clock_out_at: nil,
        hours: 0
      )

      expect(described_class.flag_stale_entries(threshold_hours: 12)).to eq(1)

      expect(entry.reload).to have_attributes(
        status: "completed",
        approval_status: "pending",
        time_category_id: assigned_category.id
      )
      expect(AuditLog.where(auditable: entry, action: "time_entry.auto_closed")).to exist
      repair_audit = AuditLog.find_by!(auditable: entry, action: "time_entry.category_auto_assigned")
      expect(repair_audit).to have_attributes(actor_kind: "system", source: "system")
      expect(repair_audit.metadata).to include(
        "previous_time_category_id" => nil,
        "assigned_time_category_id" => assigned_category.id,
        "trigger_action" => "time_entry.auto_closed"
      )
    end
  end

  describe "approval category requirements" do
    let(:admin) { create(:user, :admin) }

    it "rejects regular approval for a categoryless entry without changing its state" do
      entry = create(
        :time_entry,
        user: user,
        approval_status: "pending",
        approved_by: nil,
        approved_at: nil
      )
      entry.update_column(:time_category_id, nil)
      entry.reload

      expect {
        described_class.approve_entry(entry: entry, approved_by: admin)
      }.to raise_error(TimeClockService::ClockError, /Choose a work category/)

      expect(entry.reload).to have_attributes(
        approval_status: "pending",
        approved_by_id: nil,
        approved_at: nil
      )
    end

    it "rejects overtime approval for a categoryless entry without changing its state" do
      entry = create(
        :time_entry,
        user: user,
        approval_status: "approved",
        overtime_status: "pending",
        overtime_approved_by: nil,
        overtime_approved_at: nil
      )
      entry.update_column(:time_category_id, nil)
      entry.reload

      expect {
        described_class.approve_overtime(entry: entry, approved_by: admin)
      }.to raise_error(TimeClockService::ClockError, /Choose a work category/)

      expect(entry.reload).to have_attributes(
        overtime_status: "pending",
        overtime_approved_by_id: nil,
        overtime_approved_at: nil
      )
    end
  end

  describe ".current_status" do
    it "reports an active overnight entry after midnight" do
      Setting.set("schedule_required_for_clock_in", "false")
      time_category = create(:time_category)
      UserTimeCategory.create!(user: user, time_category: time_category)
      overnight_start = guam_zone.local(2026, 4, 2, 23, 30, 0)

      travel_to(overnight_start)
      entry = described_class.clock_in(user: user, time_category_id: time_category.id)

      travel_to(overnight_start + 2.hours)
      status = described_class.current_status(user: user)

      expect(status[:clocked_in]).to be(true)
      expect(status[:entry_id]).to eq(entry.id)
      expect(status[:clock_in_blocked_reason]).to eq("already_clocked_in")
      expect(status[:can_clock_in]).to be(false)
    end

    it "includes the location policy for the frontend clock-in guard" do
      Setting.set("clock_in_location_enforced", "true")

      status = described_class.current_status(user: user)

      expect(status[:clock_in_location_required]).to be(true)
      expect(status[:clock_in_location_name]).to eq("AIRE Services Guam")
      expect(status[:clock_in_location_radius_meters]).to eq(1000)
    end
  end

  describe ".switch_category" do
    it "blocks employees from switching to an unassigned category" do
      Setting.set("schedule_required_for_clock_in", "false")
      assigned_category = create(:time_category)
      unassigned_category = create(:time_category)
      UserTimeCategory.create!(user: user, time_category: assigned_category)
      described_class.clock_in(user: user, time_category_id: assigned_category.id)

      expect {
        described_class.switch_category(user: user, time_category_id: unassigned_category.id)
      }.to raise_error(TimeClockService::ClockError, /not assigned/)
    end


    it "uses the selected target to repair a legacy categoryless active segment" do
      Setting.set("schedule_required_for_clock_in", "false")
      target_category = create(:time_category)
      UserTimeCategory.create!(user: user, time_category: target_category)
      legacy_entry = create(
        :time_entry,
        user: user,
        time_category: nil,
        entry_method: "clock",
        status: "clocked_in",
        start_time: frozen_time,
        clock_in_at: frozen_time,
        end_time: nil,
        clock_out_at: nil,
        hours: 0
      )

      travel 1.hour
      new_entry = described_class.switch_category(user: user, time_category_id: target_category.id)

      expect(legacy_entry.reload.time_category).to eq(target_category)
      expect(legacy_entry.status).to eq("completed")
      expect(new_entry.time_category).to eq(target_category)
      expect(new_entry.status).to eq("clocked_in")

      audit = AuditLog.find_by!(auditable: new_entry, action: "time_entry.category_switched")
      expect(audit.metadata).to include(
        "previous_entry_id" => legacy_entry.id,
        "previous_time_category_id" => nil
      )
    end
  end
end
