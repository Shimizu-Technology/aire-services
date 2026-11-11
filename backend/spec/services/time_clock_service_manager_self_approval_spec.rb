# frozen_string_literal: true

require "rails_helper"

# "Managers can approve their own time" (Settings). On by default; off sends a
# manager's own time to another approver. Owners and admins are unaffected.
RSpec.describe TimeClockService, "manager self-approval setting", type: :service do
  include ActiveSupport::Testing::TimeHelpers

  let(:guam_zone) { ActiveSupport::TimeZone[described_class::BUSINESS_TIMEZONE] }
  let(:category) { create(:time_category) }
  let(:manager) { create(:user, :manager, time_tracking_enabled: true, kiosk_enabled: true) }
  let(:other_manager) { create(:user, :manager) }
  let(:admin) { create(:user, :admin, time_tracking_enabled: true, kiosk_enabled: true) }
  let(:employee) { create(:user, :employee) }

  around do |example|
    travel_to(guam_zone.local(2026, 4, 2, 9, 0, 0)) { example.run }
  end

  before do
    [ manager, admin ].each { |user| user.user_time_categories.create!(time_category: category) }
  end

  def pending_entry_for(user, **attrs)
    create(:time_entry, user: user, time_category: category, approval_status: "pending", **attrs)
  end

  context "when on (the default)" do
    it "lets a manager approve, deny and review overtime on their own time" do
      approved = pending_entry_for(manager)
      denied = pending_entry_for(manager)
      overtime = pending_entry_for(manager, approval_status: "approved", overtime_status: "pending")

      described_class.approve_entry(entry: approved, approved_by: manager)
      described_class.deny_entry(entry: denied, denied_by: manager, note: "Duplicate")
      described_class.approve_overtime(entry: overtime, approved_by: manager)

      expect(approved.reload.approval_status).to eq("approved")
      expect(denied.reload.approval_status).to eq("denied")
      expect(overtime.reload.overtime_status).to eq("approved")
    end

    it "queues a manager's own clock, which they may then approve, and allows self overrides" do
      described_class.clock_in(user: manager, admin_override_by: manager, time_category_id: category.id)
      travel 2.hours
      entry = described_class.clock_out(user: manager)

      expect(entry.approval_status).to eq("pending")
      expect(entry.approval_note).to eq("Clocked in without a schedule | Supervisor's own time")
      expect(described_class.current_status(user: manager)[:can_override_clock]).to be(true)

      described_class.approve_entry(entry: entry, approved_by: manager)
      expect(entry.reload).to have_attributes(approval_status: "approved", approved_by_id: manager.id)
    end
  end

  context "when off" do
    before { Setting.set(Setting::MANAGERS_CAN_APPROVE_OWN_TIME_KEY, "false") }

    it "refuses every review of a manager's own time and leaves it pending" do
      entry = pending_entry_for(manager, overtime_status: "pending")

      expect { described_class.approve_entry(entry: entry, approved_by: manager) }
        .to raise_error(TimeClockService::AuthorizationError, described_class::OWN_TIME_REVIEW_MESSAGE)
      expect { described_class.deny_entry(entry: entry, denied_by: manager, note: "No") }
        .to raise_error(TimeClockService::AuthorizationError, described_class::OWN_TIME_REVIEW_MESSAGE)
      expect { described_class.approve_overtime(entry: entry, approved_by: manager) }
        .to raise_error(TimeClockService::AuthorizationError, described_class::OWN_TIME_REVIEW_MESSAGE)
      expect { described_class.deny_overtime(entry: entry, denied_by: manager, note: "No") }
        .to raise_error(TimeClockService::AuthorizationError, described_class::OWN_TIME_REVIEW_MESSAGE)

      expect(entry.reload).to have_attributes(approval_status: "pending", overtime_status: "pending", approved_by_id: nil)
    end

    it "lets a manager review other people's time, and others review the manager's" do
      employee_entry = pending_entry_for(employee)
      manager_entry = pending_entry_for(manager)
      other_manager_entry = pending_entry_for(manager)

      described_class.approve_entry(entry: employee_entry, approved_by: manager)
      described_class.approve_entry(entry: manager_entry, approved_by: admin)
      described_class.approve_entry(entry: other_manager_entry, approved_by: other_manager)

      expect(employee_entry.reload.approved_by).to eq(manager)
      expect(manager_entry.reload.approved_by).to eq(admin)
      expect(other_manager_entry.reload.approved_by).to eq(other_manager)
    end

    it "sends a manager's unscheduled clock to the queue" do
      described_class.clock_in(user: manager, time_category_id: category.id)
      travel 2.hours
      entry = described_class.clock_out(user: manager)

      expect(entry.approval_status).to eq("pending")
      expect(entry.approval_note).to eq("Clocked in without a schedule | Supervisor's own time")
    end

    it "refuses a manager's override of their own clock" do
      expect { described_class.clock_in(user: manager, admin_override_by: manager, time_category_id: category.id) }
        .to raise_error(TimeClockService::AuthorizationError, described_class::OWN_CLOCK_OVERRIDE_MESSAGE)
      expect(manager.time_entries).to be_empty
      expect(described_class.current_status(user: manager)[:can_override_clock]).to be(false)
    end

    it "does not change owners' and admins' own time" do
      entry = pending_entry_for(admin, overtime_status: "pending")

      described_class.approve_entry(entry: entry, approved_by: admin)
      described_class.approve_overtime(entry: entry.reload, approved_by: admin)
      expect(entry.reload).to have_attributes(approval_status: "approved", overtime_status: "approved")

      travel 1.day
      described_class.clock_in(user: admin, admin_override_by: admin, time_category_id: category.id)
      travel 2.hours
      own = described_class.clock_out(user: admin)
      expect(own.approval_status).to eq("pending")
      described_class.approve_entry(entry: own, approved_by: admin)
      expect(own.reload).to have_attributes(approval_status: "approved", approved_by_id: admin.id)
    end
  end
end
