# frozen_string_literal: true

module Payroll
  # An installation with pre-calendar manual payroll must reconcile its old
  # source ledger before adopting scheduled payroll. A date-range preview is
  # not evidence that those historical hours are still owed.
  class LegacyPaidHistoryGuard
    MESSAGE = "Historical manually paid hours need reconciliation. Use Record already processed for each paid period before enabling payroll; hold edited or older entries with Report already paid pending evidence, then reconcile their exact paycheck allocations."

    def self.uncovered_entries
      rollout = PayrollLockRollout.find_by(id: 1)
      legacy = legacy_batches
      return TimeEntry.none unless rollout && legacy.exists?

      TimeEntry.joins(:user).merge(User.staff)
        .where("work_date < ?", rollout.cutoff_enforcement_starts_on)
        .where.not(id: PayrollBatchEntry.effective.select(:source_time_entry_id))
        .where.not(id: PayrollManualAllocation.active.select(:time_entry_id))
        .where.not(id: PayrollPaymentAttestation.pending_evidence.select(:time_entry_id))
        .includes(:user, :time_entry_breaks)
    end

    def self.legacy_batches
      PayrollBatch.regular.joins(:payroll_batch_processing_events)
        .where(payroll_batch_processing_events: { status: "committed", external_system: "cornerstone_payroll_manual" })
        .where.not(id: PayrollCalendarPeriod.where.not(payroll_batch_id: nil).select(:payroll_batch_id))
    end

    def self.blocked?
      return true if !PayrollLockRollout.exists?(id: 1) && legacy_batches.exists?

      uncovered_entries.any?(&:counts_toward_hours?)
    end

    def self.check!
      raise BatchFinalizer::FinalizationError, MESSAGE if blocked?
    end
  end
end
