# frozen_string_literal: true

module Payroll
  class ManualAllocationLedger
    class CoverageError < TimeEntryRevisionLedger::CoverageError; end

    def self.active_at(cutoff_at, entry_ids:, allocation_ids: nil)
      ids = Array(entry_ids).uniq
      return [] if ids.empty?

      allocations = PayrollManualAllocation.where(time_entry_id: ids)
      revisions = PayrollManualAllocationRevision.where(source_time_entry_id: ids)
      if allocation_ids
        allocations = allocations.where(id: allocation_ids)
        revisions = revisions.where(payroll_manual_allocation_id: allocation_ids)
      end
      covered = revisions.where("recorded_at <= ?", cutoff_at).select(:payroll_manual_allocation_id)
      if allocations.where("created_at <= ?", cutoff_at).where.not(id: covered).exists?
        raise CoverageError, "Trusted manual reservation history does not cover this cutoff; reconcile legacy payroll coverage before retrying"
      end

      latest = revisions.where("recorded_at <= ?", cutoff_at)
        .select("DISTINCT ON (payroll_manual_allocation_id) payroll_manual_allocation_revisions.*")
        .order(:payroll_manual_allocation_id, recorded_at: :desc, id: :desc)
      latest.filter_map do |revision|
        next unless revision.snapshot.fetch("status").in?(PayrollManualAllocation::ACTIVE_STATUSES)

        PayrollManualAllocation.instantiate(revision.snapshot)
      end
    end
  end
end
