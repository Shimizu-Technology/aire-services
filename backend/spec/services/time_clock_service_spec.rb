# frozen_string_literal: true

require "rails_helper"

RSpec.describe TimeClockService, type: :service do
  include ActiveSupport::Testing::TimeHelpers

  let(:user) { create(:user, :employee) }
  let(:guam_zone) { ActiveSupport::TimeZone[described_class::BUSINESS_TIMEZONE] }
  let(:frozen_time) { guam_zone.local(2026, 4, 2, 9, 0, 0) }

  around do |example|
    travel_to(frozen_time) { example.run }
  end

  describe ".clock_in" do
    it "allows clock-in without a schedule when the schedule requirement is disabled" do
      Setting.set("schedule_required_for_clock_in", "false")

      entry = described_class.clock_in(user: user)

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

      status = described_class.current_status(user: user)

      expect(status[:schedule_required_for_clock_in]).to be(true)
      expect(status[:clock_in_blocked_reason]).to eq("no_schedule")
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

    it "allows admins to override category assignment for another employee" do
      Setting.set("schedule_required_for_clock_in", "false")
      admin = create(:user, :admin)
      unassigned_category = create(:time_category)

      entry = described_class.clock_in(
        user: user,
        admin_override_by: admin,
        time_category_id: unassigned_category.id
      )

      expect(entry.time_category_id).to eq(unassigned_category.id)
      expect(entry.admin_override).to be(true)
    end
  end

  describe ".clock_out" do
    it "snapshots the effective rate when a clock entry is completed" do
      Setting.set("schedule_required_for_clock_in", "false")
      time_category = create(:time_category, hourly_rate_cents: 3000)
      UserTimeCategory.create!(user: user, time_category: time_category)
      create(:employee_pay_rate, user: user, time_category: time_category, hourly_rate_cents: 4800)

      entry = described_class.clock_in(user: user, time_category_id: time_category.id)
      expect(entry.effective_rate_cents_snapshot).to be_nil

      travel 2.hours
      described_class.clock_out(user: user)

      entry.reload
      expect(entry.status).to eq("completed")
      expect(entry.effective_rate_cents_snapshot).to eq(4800)
      expect(entry.effective_rate).to eq(48.0)

      time_category.update!(hourly_rate_cents: 7200)
      user.employee_pay_rates.find_by(time_category: time_category)&.update!(hourly_rate_cents: 8100)
      entry.reload

      expect(entry.effective_rate_cents_snapshot).to eq(4800)
      expect(entry.effective_rate_cents).to eq(4800)
      expect(entry.effective_rate).to eq(48.0)
    end

    it "allows clock-out after midnight for an overnight shift" do
      Setting.set("schedule_required_for_clock_in", "false")
      overnight_start = guam_zone.local(2026, 4, 2, 23, 30, 0)

      travel_to(overnight_start)
      described_class.clock_in(user: user)

      travel_to(overnight_start + 2.hours)
      entry = described_class.clock_out(user: user)

      expect(entry).to be_persisted
      expect(entry.status).to eq("completed")
      expect(entry.hours).to eq(2.0)
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
  end
end
