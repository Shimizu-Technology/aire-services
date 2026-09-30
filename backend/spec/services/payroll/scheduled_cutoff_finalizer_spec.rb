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

  def period_dates_before(pay_date)
    end_date = if pay_date.day > 15
      Date.new(pay_date.year, pay_date.month, 15)
    else
      (pay_date << 1).end_of_month
    end
    start_date = end_date.day == 15 ? end_date.beginning_of_month : Date.new(end_date.year, end_date.month, 16)
    [ start_date, end_date ]
  end

  def revision_cutoff_period(cutoff_at)
    pay_date = cutoff_at.in_time_zone("Pacific/Guam").to_date + 7.days
    start_date, end_date = period_dates_before(pay_date)
    create(
      :payroll_calendar_period,
      start_date: start_date,
      end_date: end_date,
      pay_date: pay_date,
      cutoff_at: cutoff_at,
      next_finalization_attempt_at: cutoff_at
    )
  end

  def entry_for_revision_cutoff
    local_today = Time.current.in_time_zone("Pacific/Guam").to_date
    start_date, = period_dates_before(local_today + 7.days)
    time_entry(
      entry_method: "clock",
      approval_status: nil,
      work_date: start_date + 4.days,
      created_at: Time.current - 1.day
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

  it "uses the time ledger at the cutoff when an entry is edited before delayed finalization" do
    entry = entry_for_revision_cutoff
    cutoff_revision = PayrollTimeEntryRevision.where(source_time_entry_id: entry.id).order(:id).last
    frozen_period = revision_cutoff_period(cutoff_revision.recorded_at)
    entry.update_columns(hours: 12, updated_at: Time.current)

    travel_to(cutoff_revision.recorded_at + 2.minutes) do
      result = described_class.new(period_id: frozen_period.id).call
      Payroll::SettlementCaseCoordinator.sync_finalized_periods!

      expect(result.fetch(:status)).to eq("finalized")
      expect(frozen_period.reload.payroll_batch.payroll_batch_entries.sole.total_hours).to eq(8)
      expect(frozen_period.payroll_batch.payroll_batch_entries.sole.snapshot).to include("hours" => 8.0)
      expect(PayrollSettlementCase.find_by!(source_time_entry_id: entry.id)).to have_attributes(
        origin_reason: "changed_after_cutoff",
        held_total_hours: 4
      )
    end
  end

  it "uses the time ledger at the cutoff when an entry is deleted before delayed finalization" do
    entry = entry_for_revision_cutoff
    cutoff_revision = PayrollTimeEntryRevision.where(source_time_entry_id: entry.id).order(:id).last
    frozen_period = revision_cutoff_period(cutoff_revision.recorded_at)
    entry.destroy!

    travel_to(cutoff_revision.recorded_at + 2.minutes) do
      result = described_class.new(period_id: frozen_period.id).call
      Payroll::SettlementCaseCoordinator.sync_finalized_periods!

      expect(result.fetch(:status)).to eq("finalized")
      expect(frozen_period.reload.payroll_batch.payroll_batch_entries.sole).to have_attributes(
        source_time_entry_id: entry.id,
        total_hours: 8
      )
      expect(PayrollSettlementCase.find_by!(source_time_entry_id: entry.id)).to have_attributes(
        origin_reason: "deleted_after_cutoff",
        held_total_hours: 8
      )
    end
  end

  it "keeps deleted post-cutoff time visible as held for the following payroll" do
    included = entry_for_revision_cutoff
    cutoff_revision = PayrollTimeEntryRevision.where(source_time_entry_id: included.id).order(:id).last
    frozen_period = revision_cutoff_period(cutoff_revision.recorded_at)
    late = time_entry(
      entry_method: "clock",
      approval_status: nil,
      work_date: frozen_period.start_date + 5.days,
      created_at: cutoff_revision.recorded_at + 1.minute
    )
    late.destroy!

    travel_to(cutoff_revision.recorded_at + 2.minutes) do
      result = described_class.new(period_id: frozen_period.id).call

      expect(result.fetch(:status)).to eq("finalized")
      expect(frozen_period.reload.payroll_batch.payroll_batch_entries.pluck(:source_time_entry_id)).to eq([ included.id ])
      expect(frozen_period.payroll_batch.payroll_batch_exclusions.find_by!(source_time_entry_id: late.id))
        .to have_attributes(reason: "created_after_cutoff", held_total_hours: 8)
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

  it "does not misclassify reconciliation failure as a failure of a directly requested cutoff" do
    time_entry(entry_method: "clock", approval_status: nil)
    allow(Payroll::SettlementCaseCoordinator).to receive(:sync_finalized_periods!).and_raise("old reconciliation failed")
    allow(Rails.error).to receive(:report)

    travel_to(cutoff + 2.minutes) do
      result = described_class.new(period_id: period.id).call

      expect(result[:status]).to eq("finalized")
      expect(period.reload.status).to eq("finalized")
      expect(AuditLog.where(action: "payroll_calendar_period.finalization_failed", auditable: period)).not_to exist
    end
  end

  it "continues processing due periods when the reconciliation sweep fails" do
    time_entry(entry_method: "clock", approval_status: nil)
    allow(Payroll::SettlementCaseCoordinator).to receive(:sync_finalized_periods!).and_raise("old reconciliation failed")
    allow(Rails.error).to receive(:report)

    travel_to(cutoff + 2.minutes) do
      result = described_class.call_due

      expect(result).to contain_exactly(include(status: "finalized"))
      expect(period.reload.status).to eq("finalized")
    end
  end

  it "blocks out-of-order automated finalization without retrying or pulling future carryovers backward" do
    later_batch = PayrollBatch.create!(
      public_id: "AIRE-PAY-LATER-BATCH",
      start_date: Date.new(2026, 10, 16),
      end_date: Date.new(2026, 10, 31),
      cutoff_at: cutoff + 15.days,
      finalized_at: cutoff + 15.days,
      checksum: "b" * 64
    )
    later_entry = time_entry(
      entry_method: "clock",
      approval_status: nil,
      work_date: Date.new(2026, 10, 20),
      created_at: cutoff + 10.days
    )
    later_batch.payroll_batch_exclusions.create!(
      source_time_entry_id: later_entry.id,
      source_user_id: later_entry.user_id,
      source_user_uuid: later_entry.user.payroll_integration_uuid,
      reason: "pending_approval",
      held_total_hours: later_entry.hours,
      snapshot: { work_date: later_entry.work_date.iso8601 }
    )

    travel_to(cutoff + 20.days) do
      result = described_class.new(period_id: period.id, now: Time.current).call
      period.reload

      expect(result).to include(status: "failed", error: /later payroll batch/)
      expect(period.status).to eq("failed")
      expect(period.next_finalization_attempt_at).to be_nil
      expect(period.last_finalization_error).to include("Review this older period")
      expect(period.payroll_batch).to be_nil
      expect(PayrollBatch.count).to eq(1)
      expect(PayrollSettlementCase.count).to eq(0)
      audit = AuditLog.find_by!(action: "payroll_calendar_period.finalization_failed", auditable: period)
      expect(audit.metadata).to include("retryable" => false, "retry_at" => nil)
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
