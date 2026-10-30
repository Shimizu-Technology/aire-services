# frozen_string_literal: true

require "rails_helper"

RSpec.describe "Connected payroll pause" do
  before { allow(ConnectedPayrollMode).to receive(:enabled?).and_return(false) }

  it "holds automatic finalization before reconciliation, attempts or locking, including existing calendars" do
    period = create(:payroll_calendar_period)
    original = period.attributes
    expect(Payroll::BatchFinalizer).not_to receive(:new)
    expect(Payroll::SettlementCaseCoordinator).not_to receive(:sync_finalized_periods!)
    PayrollCutoffFinalizationJob.perform_now
    expect(Payroll::ScheduledCutoffFinalizer.new(period_id: period.id).call[:status]).to eq("paused")
    expect(period.reload.attributes).to eq(original)
  end

  it "holds manual locks and hides imminent automatic-lock warnings" do
    period = create(:payroll_calendar_period)
    actor = create(:user, :admin)
    expect(Payroll::ManualCalendarFinalizer.new(period_id: period.id, actor: actor, reason: "Review complete").call[:status]).to eq("paused")
    expect(Payroll::CutoffPresenter.call(period: period)).to include(stage: "none", cutoff_at: nil, seconds_remaining: nil)
    expect(Payroll::CutoffPresenter.period(now: Time.current)).to be_nil
  end
end
