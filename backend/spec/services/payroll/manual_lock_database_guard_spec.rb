# frozen_string_literal: true

require "rails_helper"

RSpec.describe "Manual calendar database finalization guard" do
  let(:actor) { create(:user, :admin) }
  let(:period) do
    create(:payroll_calendar_period, start_date: "2026-10-01", end_date: "2026-10-15",
      pay_date: "2026-10-31", cutoff_at: "2026-10-24T17:00:00+10:00", lock_mode: "manual",
      cutoff_enforcement_starts_on: "2026-10-16")
  end

  it "rejects the nil-actor batch transaction produced by an old scheduler without weakening cutoff triggers" do
    original_cutoff = period.cutoff_at
    expect do
      PayrollBatch.transaction(requires_new: true) do
        batch = create(:payroll_batch, start_date: period.start_date, end_date: period.end_date,
          cutoff_at: period.cutoff_at, finalized_by: nil)
        period.update!(status: "finalized", payroll_batch: batch, finalized_at: batch.finalized_at)
      end
    end.to raise_error(ActiveRecord::StatementInvalid, /explicit audited manual lock/)
    expect(period.reload.status).to eq("scheduled")
    expect(period.cutoff_at).to eq(original_cutoff)
    expect(PayrollBatch.count).to eq(0)
    connection = ActiveRecord::Base.connection
    expect(connection.select_value("SELECT tgenabled FROM pg_trigger WHERE tgname = 'payroll_calendar_periods_cutoff_guard'")).to eq("O")
  end

  it "rejects an actor-bearing batch without the explicit reasoned manual-lock audit" do
    period
    expect do
      PayrollBatch.transaction(requires_new: true) do
        batch = create(:payroll_batch, start_date: period.start_date, end_date: period.end_date,
          cutoff_at: Time.current, finalized_by: actor)
        period.update!(status: "finalized", payroll_batch: batch, finalized_at: batch.finalized_at)
      end
    end.to raise_error(ActiveRecord::StatementInvalid, /explicit audited manual lock/)
  end

  it "requires a persisted actor and accepts the explicit audited manual lock transaction" do
    period
    expect do
      Payroll::ManualCalendarFinalizer.new(period_id: period.id, actor: build(:user, :admin), reason: "Reviewed manual calendar")
    end.to raise_error(ArgumentError, /persisted/)
    result = Payroll::ManualCalendarFinalizer.new(period_id: period.id, actor: actor, reason: "Reviewed manual calendar").call
    expect(result[:status]).to eq("finalized"), result.inspect
    expect(period.reload.payroll_batch.finalized_by).to eq(actor)
  end
end
