# frozen_string_literal: true

module Payroll
  # A lock-now publication carries the instant the admin pressed Lock now, and
  # can reach AIRE a little after it. Until it arrives AIRE still shows the
  # earlier lock time, so the pending-cutoff guard lets payroll claims through.
  # The batch is frozen as of the lock-now instant and would not see a claim
  # recorded in that gap, so the same hours could be paid twice. Refuse the
  # publication instead; Cornerstone shows the refusal and the admin can press
  # Lock now again for a fresh instant.
  class LockNowClaimFence
    class ConflictError < StandardError; end

    # Call inside the publisher's transaction, after it holds the publication
    # advisory lock and the period row: the same order as the scheduled
    # finalizer, which takes the batch lock after a period row.
    def self.call!(start_date:, end_date:, cutoff_at:, period: nil)
      ActiveRecord::Base.connection.execute("SELECT pg_advisory_xact_lock(#{BatchFinalizer::ADVISORY_LOCK_KEY})")
      new(start_date: start_date, end_date: end_date, cutoff_at: cutoff_at, period: period).call!
    end

    def initialize(start_date:, end_date:, cutoff_at:, period:)
      @range = start_date..end_date
      @cutoff_at = cutoff_at
      @period = period
    end

    def call!
      kind = claim_kind
      return unless kind

      raise ConflictError,
            "A #{kind} for these hours was recorded after #{@cutoff_at.in_time_zone(PayrollCalendarPeriod::BUSINESS_TIME_ZONE).strftime('%-l:%M %p')}, " \
            "the Lock now time. Press Lock now again so the lock includes it."
    end

    private

    def claim_kind
      return "manual paycheck" if overlapping?(PayrollManualAllocationRevision.where("recorded_at > ?", @cutoff_at).distinct.pluck(:source_time_entry_id))

      late_hours = PayrollBatchEntry.joins(:payroll_batch)
        .where("payroll_batch_entries.created_at > ?", @cutoff_at)
        .where("payroll_batches.payload->>'purpose' = 'supplemental'")
        .distinct.pluck(:source_time_entry_id)
      return "late-hours payment" if overlapping?(late_hours)

      "settlement change" if settlement_claimed?
    end

    def settlement_claimed?
      cases = PayrollSettlementCase.where(id: PayrollSettlementCaseEvent.where("created_at > ?", @cutoff_at).select(:payroll_settlement_case_id))
      return true if @period && cases.where(target_payroll_calendar_period_id: @period.id).exists?
      return true if cases.where(original_work_date: @range).exists?

      overlapping?(cases.distinct.pluck(:source_time_entry_id))
    end

    def overlapping?(entry_ids)
      return false if entry_ids.empty?

      TimeEntry.where(id: entry_ids).find_each.any? { |entry| PayableIntervals.overlaps?(entry, @range) }
    end
  end
end
