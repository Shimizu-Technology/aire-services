# frozen_string_literal: true

module Payroll
  # Arbitrary ranges have no settlement destination. Calendar payroll instead
  # quarantines individual legacy entries for explicit administrator routing.
  class LegacyPaidHistoryGuard
    MESSAGE = "Historical manually paid hours need reconciliation. Use Record already processed for each paid period before enabling payroll; review uncovered entries in the settlement workspace."

    def self.legacy_entries
      rollout = PayrollLockRollout.find_by(id: 1)
      return TimeEntry.none unless rollout && legacy_batches.exists?

      TimeEntry.joins(:user).merge(User.staff)
        .where("time_entries.work_date < ?", rollout.cutoff_enforcement_starts_on)
    end

    def self.uncovered_entries
      scope = legacy_entries.where(status: "completed")
        .where("time_entries.approval_status = 'approved' OR (time_entries.entry_method = 'clock' AND time_entries.approval_status IS NULL)")
      [ [ PayrollBatchEntry.effective, :source_time_entry_id ],
        [ PayrollManualAllocation.active, :time_entry_id ],
        [ PayrollPaymentAttestation.pending_evidence, :time_entry_id ] ].each do |covered, column|
        correlated = covered.where(covered.arel_table[column].eq(TimeEntry.arel_table[:id]))
        scope = scope.where(correlated.arel.exists.not)
      end
      scope
    end

    def self.legacy_entry_ids(entry_ids)
      rollout = PayrollLockRollout.find_by(id: 1)
      return [] unless rollout && legacy_batches.exists?

      live = legacy_entries.where(id: entry_ids).pluck(:id)
      # Deleted/moved source rows still have immutable paid history. They need
      # the same explicit-routing fence as a currently present legacy source.
      represented = PayrollBatchEntry.effective.where(source_time_entry_id: entry_ids,
        payroll_batch_id: legacy_batches.select(:id))
        .where("payroll_batch_entries.work_date < ?", rollout.cutoff_enforcement_starts_on)
        .pluck(:source_time_entry_id)
      (live + represented).uniq
    end

    def self.legacy_batches
      PayrollBatch.regular.joins(:payroll_batch_processing_events)
        .where(payroll_batch_processing_events: { status: "committed", external_system: "cornerstone_payroll_manual" })
        .where.not(id: PayrollCalendarPeriod.where.not(payroll_batch_id: nil).select(:payroll_batch_id))
    end

    def self.blocked?
      return true if !PayrollLockRollout.exists?(id: 1) && legacy_batches.exists?

      uncovered_entries.exists?
    end

    def self.check!
      raise BatchFinalizer::FinalizationError, MESSAGE if blocked?
    end
  end
end
