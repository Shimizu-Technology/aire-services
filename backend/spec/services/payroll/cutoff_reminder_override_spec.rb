# frozen_string_literal: true

require "rails_helper"
require_relative "../../support/payroll_cutoff_override_helpers"

RSpec.describe Payroll::CutoffApprovalReminder, "with an admin lock time" do
  include ActiveSupport::Testing::TimeHelpers
  include PayrollCutoffOverrideHelpers

  let(:guam) { ActiveSupport::TimeZone["Pacific/Guam"] }
  let(:dates) { ended_period_dates }
  let(:base) { policy_publication(dates) }
  let(:delivered) { [] }
  let(:period) { PayrollCalendarPeriod.find_by!(external_pay_period_id: base.fetch(:external_pay_period_id)) }

  before do
    configure_lock_rollout!(dates)
    Payroll::CalendarPeriodPublisher.new(base).call
    Setting.set("payroll_cutoff_reminder_emails", "approver@example.test")
    allow(StagingMailTransport).to receive(:deliver) { |payload, **| delivered << payload }
    create(:time_entry, user: create(:user, :employee), time_category: create(:time_category), work_date: dates.fetch(:start_date),
      status: "completed", entry_method: "manual", approval_status: "pending")
  end

  def at_days_before(cutoff, days, hour: 9)
    day = cutoff.in_time_zone(guam).to_date - days
    travel_to(guam.local(day.year, day.month, day.day, hour)) { described_class.call_due }
  end

  it "reminds against the moved lock time and sends again when the lock moves to another day" do
    policy_cutoff = Time.iso8601(base.fetch(:cutoff_at))
    expect(at_days_before(policy_cutoff, 2).sole[:status]).to eq("sent")
    expect(delivered.last[:subject]).to include(policy_cutoff.in_time_zone(guam).strftime("%b %-d at %-l:%M %p"))

    moved = policy_cutoff + 1.day + 2.hours
    Payroll::CalendarPeriodPublisher.new(override_publication(base, cutoff_at: moved)).call
    expect(at_days_before(moved, 2).sole[:status]).to eq("sent")
    expect(delivered.last[:subject]).to include(moved.in_time_zone(guam).strftime("%b %-d at %-l:%M %p"))
    expect(at_days_before(moved, 2, hour: 11).sole[:status]).to eq("already_sent")
    expect(delivered.size).to eq(2)
  end
end
