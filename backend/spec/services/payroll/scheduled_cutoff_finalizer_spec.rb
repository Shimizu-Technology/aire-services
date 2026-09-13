# frozen_string_literal: true

require "rails_helper"

RSpec.describe Payroll::ScheduledCutoffFinalizer do
  include ActiveSupport::Testing::TimeHelpers

  let(:guam) { ActiveSupport::TimeZone["Pacific/Guam"] }
  let(:employee) { create(:user, :employee, first_name: "Aire", last_name: "Employee") }
  let(:category) { create(:time_category, name: "Operations") }
  let(:cutoff) { guam.local(2026, 10, 18, 17) }
  let!(:period) do
    create(
      :payroll_calendar_period,
      start_date: Date.new(2026, 10, 1),
      end_date: Date.new(2026, 10, 15),
      pay_date: Date.new(2026, 10, 25),
      cutoff_at: cutoff,
      next_finalization_attempt_at: cutoff
    )
  end

  def time_entry(entry_method:, approval_status:, work_date: Date.new(2026, 10, 5), created_at: cutoff - 1.day)
    create(
      :time_entry,
      user: employee,
      time_category: category,
      work_date: work_date,
      start_time: guam.local(work_date.year, work_date.month, work_date.day, 8),
      end_time: guam.local(work_date.year, work_date.month, work_date.day, 16),
      entry_method: entry_method,
      clock_source: entry_method == "clock" ? "kiosk" : nil,
      approval_status: approval_status,
      overtime_status: "none",
      created_at: created_at,
      updated_at: created_at
    )
  end

  it "independently finalizes a due period and records every held manual entry" do
    included = time_entry(entry_method: "clock", approval_status: nil)
    held = time_entry(entry_method: "manual", approval_status: "pending", work_date: Date.new(2026, 10, 6))

    travel_to(cutoff + 2.minutes) do
      result = described_class.call_due
      period.reload

      expect(result).to contain_exactly(include(status: "finalized"))
      expect(period.status).to eq("finalized")
      expect(period.payroll_batch.cutoff_at).to eq(cutoff)
      expect(period.payroll_batch.finalized_at).to eq(Time.current)
      expect(period.payroll_batch.payroll_batch_entries.pluck(:source_time_entry_id)).to eq([ included.id ])
      expect(period.payroll_batch.payroll_batch_exclusions.pluck(:source_time_entry_id, :reason))
        .to contain_exactly([ held.id, "pending_approval" ])
      expect(period.payroll_outbox_events.count).to eq(1)
      expect(period.payroll_outbox_events.first.payload.dig("payroll_batch", "checksum"))
        .to eq(period.payroll_batch.checksum)
      expect(AuditLog.find_by!(action: "payroll_calendar_period.finalized", auditable: period).actor_kind).to eq("system")
    end
  end

  it "is idempotent when workers repeat or overlap" do
    time_entry(entry_method: "clock", approval_status: nil)

    travel_to(cutoff + 2.minutes) do
      first = described_class.new(period_id: period.id).call
      second = described_class.new(period_id: period.id).call

      expect(first[:status]).to eq("finalized")
      expect(second[:status]).to eq("finalized")
      expect(PayrollBatch.count).to eq(1)
      expect(PayrollOutboxEvent.count).to eq(1)
    end
  end

  it "uses the scheduled cutoff instant when AIRE resumes after an outage" do
    before_cutoff = time_entry(entry_method: "clock", approval_status: nil)
    late = time_entry(
      entry_method: "clock",
      approval_status: nil,
      work_date: Date.new(2026, 10, 7),
      created_at: cutoff + 30.minutes
    )

    travel_to(cutoff + 3.hours) do
      described_class.call_due
      batch = period.reload.payroll_batch

      expect(batch.payroll_batch_entries.pluck(:source_time_entry_id)).to eq([ before_cutoff.id ])
      expect(batch.payroll_batch_exclusions.find_by!(source_time_entry_id: late.id).reason).to eq("created_after_cutoff")
    end
  end

  it "persists a visible failure and retries with backoff" do
    allow(Payroll::BatchFinalizer).to receive(:new).and_raise("database unavailable")

    travel_to(cutoff + 2.minutes) do
      result = described_class.call_due
      period.reload

      expect(result).to contain_exactly(include(status: "failed", error: "database unavailable"))
      expect(period.status).to eq("failed")
      expect(period.finalization_attempts).to eq(1)
      expect(period.next_finalization_attempt_at).to eq(Time.current + 1.minute)
      expect(period.last_finalization_error).to include("database unavailable")
      expect(AuditLog.find_by!(action: "payroll_calendar_period.finalization_failed", auditable: period).outcome).to eq("failed")
    end
  end

  it "reports repeated cutoff failures to production error monitoring" do
    period.update!(finalization_attempts: 4)
    allow(Payroll::BatchFinalizer).to receive(:new).and_raise("database unavailable")
    allow(Rails.error).to receive(:report)
    allow(ENV).to receive(:fetch).and_call_original
    allow(ENV).to receive(:fetch).with("PAYROLL_RETRY_ALERT_THRESHOLD", "5").and_return("5")

    travel_to(cutoff + 2.minutes) do
      described_class.call_due
    end

    expect(Rails.error).to have_received(:report).with(
      instance_of(Payroll::RetrySchedule::RepeatedFailure),
      handled: true,
      severity: :warning,
      context: hash_including(record_type: "PayrollCalendarPeriod", record_id: period.external_pay_period_id, attempts: 5)
    )
  end
end
