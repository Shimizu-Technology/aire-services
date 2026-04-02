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
      Setting.set("schedule_required_for_clock_in", false)

      entry = described_class.clock_in(user: user)

      expect(entry).to be_persisted
      expect(entry.schedule).to be_nil
      expect(entry.status).to eq("clocked_in")
    end

    it "blocks clock-in without a schedule when the schedule requirement is enabled" do
      Setting.set("schedule_required_for_clock_in", true)

      expect {
        described_class.clock_in(user: user)
      }.to raise_error(TimeClockService::ClockError, /No shift scheduled for today/)
    end

    it "includes the schedule requirement flag in the current status payload" do
      Setting.set("schedule_required_for_clock_in", true)

      status = described_class.current_status(user: user)

      expect(status[:schedule_required_for_clock_in]).to be(true)
      expect(status[:clock_in_blocked_reason]).to eq("no_schedule")
    end
  end
end
