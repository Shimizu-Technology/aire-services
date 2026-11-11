# frozen_string_literal: true

require "rails_helper"
require_relative "../../support/payroll_cutoff_override_helpers"

RSpec.describe "Finalizing an admin-moved lock time" do
  include ActiveSupport::Testing::TimeHelpers
  include PayrollCutoffOverrideHelpers

  let(:guam) { ActiveSupport::TimeZone["Pacific/Guam"] }
  let(:dates) { ended_period_dates }
  let(:base) { policy_publication(dates) }
  let(:employee) { create(:user, :employee, first_name: "Ana", last_name: "Late") }
  let(:category) { create(:time_category, name: "Operations") }
  let(:next_dates) do
    start_date = dates.fetch(:end_date) + 1
    end_date = start_date.day == 1 ? start_date.change(day: 15) : start_date.end_of_month
    { start_date: start_date, end_date: end_date, pay_date: end_date + 10 }
  end

  def clocked_entry(day_offset, created_at:)
    work_date = dates.fetch(:start_date) + day_offset
    create(:time_entry, user: employee, time_category: category, work_date: work_date,
      start_time: guam.local(work_date.year, work_date.month, work_date.day, 8),
      end_time: guam.local(work_date.year, work_date.month, work_date.day, 16),
      entry_method: "clock", clock_source: "kiosk", approval_status: nil, overtime_status: "none",
      created_at: created_at, updated_at: created_at)
  end

  before do
    configure_lock_rollout!(dates)
    Payroll::CalendarPeriodPublisher.new(base).call
    Payroll::CalendarPeriodPublisher.new(policy_publication(next_dates, external_id: "6c6f636b-0000-4000-8000-0000000000f2")).call
  end

  it "locks at the chosen instant, sends the matching batch contract, and moves later hours to the next period" do
    on_time = clocked_entry(2, created_at: 2.days.ago)
    # The time ledger uses database time, so the lock instant must follow the
    # entry above and precede the one clocked after the lock.
    locked_at = (PayrollClockHelpers.database_clock + 1.second).change(usec: 0)
    PayrollClockHelpers.wait_for_database_cutoff(locked_at)
    Payroll::CalendarPeriodPublisher.new(override_publication(base, cutoff_at: locked_at, action: "lock_now")).call
    late_work_date = clocked_entry(3, created_at: Time.current)

    period = PayrollCalendarPeriod.find_by!(external_pay_period_id: base.fetch(:external_pay_period_id))
    travel_to(locked_at + 10.minutes) do
      expect(Payroll::ScheduledCutoffFinalizer.call_due).to include(include(period_id: period.id, status: "finalized"))
      Payroll::SettlementCaseCoordinator.sync_finalized_periods!
    end

    batch = period.reload.payroll_batch
    expect(batch.cutoff_at).to eq(locked_at)
    expect(batch.contract_cutoff_at).to eq(locked_at.utc.iso8601)
    expect(batch.payroll_batch_entries.pluck(:source_time_entry_id)).to eq([ on_time.id ])
    expect(batch.payroll_batch_exclusions.find_by!(source_time_entry_id: late_work_date.id).reason).to eq("created_after_cutoff")

    event = period.payroll_outbox_events.sole.payload
    expect(Time.iso8601(event.dig("payroll_period", "cutoff_at"))).to eq(locked_at)
    expect(event.dig("payroll_period", "cutoff_source")).to eq("override")
    expect(Time.iso8601(event.dig("payroll_batch", "cutoff_at"))).to eq(locked_at)

    next_period = PayrollCalendarPeriod.find_by!(external_pay_period_id: "6c6f636b-0000-4000-8000-0000000000f2")
    expect(PayrollSettlementCase.find_by!(source_time_entry_id: late_work_date.id)).to have_attributes(
      origin_reason: "created_after_cutoff", target_payroll_calendar_period_id: next_period.id
    )
  end

  it "waits for a later admin lock time instead of the policy cutoff" do
    later = Time.iso8601(base.fetch(:cutoff_at)) + 1.day
    Payroll::CalendarPeriodPublisher.new(override_publication(base, cutoff_at: later)).call
    period = PayrollCalendarPeriod.find_by!(external_pay_period_id: base.fetch(:external_pay_period_id))

    travel_to(Time.iso8601(base.fetch(:cutoff_at)) + 1.minute) do
      expect(Payroll::ScheduledCutoffFinalizer.call_due.map { |result| result[:period_id] }).not_to include(period.id)
      expect(Payroll::CutoffPresenter.call(period: period)).to include(cutoff_at: later.utc.iso8601, stage: "24h")
    end
  end
end
