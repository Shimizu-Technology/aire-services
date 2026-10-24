# frozen_string_literal: true

module Payroll
  # A current claim must not take work still owned by a delayed frozen cutoff.
  class PendingCutoffClaimGuard
    class ConflictError < StandardError; end

    def self.call!(entry:, reservation_recorded_at: nil, fence_relevant_snapshots: false)
      now = ActiveRecord::Base.connection.select_value("SELECT clock_timestamp()")
      PayrollCalendarPeriod.where.not(status: "finalized").where("cutoff_at <= ?", now).order(:cutoff_at, :id).each do |period|
        next if reservation_recorded_at && period.cutoff_at >= reservation_recorded_at

        frozen_entry = TimeEntryRevisionLedger.new(cutoff_at: period.cutoff_at).entries_for_ids([ entry.id ]).first
        range = period.start_date..period.end_date
        relevant = PayableIntervals.overlaps?(entry, range) ||
          (frozen_entry && PayableIntervals.overlaps?(frozen_entry, range)) ||
          PayrollSettlementCase.active.exists?(target_payroll_calendar_period: period, source_time_entry_id: entry.id)
        next unless relevant

        unless fence_relevant_snapshots
          result = BatchBuilder.new(start_date: period.start_date, end_date: period.end_date,
            cutoff_at: period.cutoff_at, calendar_period: period).call
          next unless result.fetch(:rows).any? { |row| row[:source_time_entry_id] == entry.id && row[:total_hours].positive? }
        end

        raise ConflictError, "Payroll cutoff #{period.external_pay_period_id} is due. Lock that cutoff and reconcile its frozen hours before committing this payroll claim"
      end
    rescue TimeEntryRevisionLedger::CoverageError, ManualAllocationLedger::CoverageError, BatchBuilder::PolicyUnavailableError => e
      raise ConflictError, "Payroll cutoff requires reconciliation before a payroll claim: #{e.message}"
    end
  end
end
