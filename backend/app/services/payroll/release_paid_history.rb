# frozen_string_literal: true

module Payroll
  # Release-specific orchestration of existing audited operator services.
  # No payment receipts, historical revisions or calendar contracts are forged.
  class ReleasePaidHistory
    ACTION = "payroll.release_paid_history_recorded"
    PERIODS = [
      [ "2026-08-16", "2026-08-31", "67" ],
      [ "2026-09-01", "2026-09-15", "76" ],
      [ "2026-09-16", "2026-09-30", "86" ],
      [ "2026-10-01", "2026-10-15", "94" ]
    ].freeze
    ANCHOR_ENTRY_COUNT = 134
    class Error < StandardError; end

    def initialize(plan:, actor:)
      @plan = plan.deep_stringify_keys
      @actor = actor
    end

    def call(apply: false, expected_digest: nil)
      PayrollBatch.transaction do
        connection = ActiveRecord::Base.connection
        connection.execute("SET LOCAL lock_timeout = '5s'")
        connection.execute("SELECT pg_advisory_xact_lock(#{CalendarPeriodPublisher::ADVISORY_LOCK_KEY})")
        connection.execute("SELECT pg_advisory_xact_lock(#{BatchFinalizer::ADVISORY_LOCK_KEY})")
        connection.execute("LOCK TABLE time_entries, time_entry_breaks, payroll_time_entry_revisions, payroll_manual_allocations, payroll_payment_attestations IN SHARE MODE")
        @legacy_entries = nil
        validate_environment_state!
        plan_checksum = CanonicalPayload.checksum(@plan)
        receipt = AuditLog.find_by(action: ACTION)
        if receipt
          raise Error, "A different paid-history plan was already applied" unless receipt.metadata.fetch("plan_checksum") == plan_checksum
          verify_receipt!(receipt)
          return { status: "already_applied", receipt_id: receipt.id, plan_checksum: plan_checksum }
        end
        validate_initial_inventory!
        holds = proposed_holds
        report = {
          plan_checksum: plan_checksum,
          hold_entry_ids: holds.map(&:id).sort,
          periods: @plan.fetch("periods"),
          entries: legacy_entries.map { |entry| [ entry.id, entry.attributes, entry.user.attributes, entry.time_entry_breaks.map(&:attributes) ] },
          categories: TimeCategory.order(:id).map(&:attributes),
          allocations: PayrollManualAllocation.order(:id).map(&:attributes),
          attestations: PayrollPaymentAttestation.order(:id).map(&:attributes),
          batches: PayrollBatch.order(:id).map(&:attributes)
        }
        digest = CanonicalPayload.checksum(report)
        return report.except(:entries, :categories, :allocations, :attestations, :batches).merge(status: "preview", preview_digest: digest) unless apply
        raise Error, "State changed or preview digest missing; preview and review again" unless expected_digest == digest

        recorder = PaymentAttestationRecorder.new(actor: @actor)
        holds.each do |entry|
          recorder.attest!(entry: entry, source_user_uuid: entry.user.payroll_integration_uuid,
            reason: "Release review: owner reports this historical period already paid; reconcile exact regular/adjustment paycheck evidence and any post-payment correction before further wages.")
        end
        batches = @plan.fetch("periods").map do |period|
          BatchFinalizer.new(
            start_date: period.fetch("start_date"), end_date: period.fetch("end_date"), actor: @actor,
            manual_processing: true, cutoff_at: period.fetch("cutoff_at"), processed_at: period.fetch("processed_at"),
            external_pay_period_id: period.fetch("external_pay_period_id"),
            processing_note: "Release reconciliation of paid regular run ##{period.fetch('external_pay_period_id')}; #83/#85 adjustments and changed/older source hours held for exact evidence."
          ).call
        end
        LegacyPaidHistoryGuard.check!
        receipt = AuditLog.record!(action: ACTION, actor: @actor, auditable: PayrollLockRollout.installation, event_category: "payroll",
          metadata: { plan_checksum: plan_checksum, preview_checksum: digest, hold_entry_ids: holds.map(&:id),
            batches: batches.to_h { |batch| [ batch.public_id, batch.checksum ] } })
        { status: "applied", receipt_id: receipt.id, batches: batches.map(&:public_id), held_count: holds.length }
      end
    end

    private

    def validate_environment_state!
      raise Error, "Keep connected payroll paused" if ConnectedPayrollMode.enabled?
      raise Error, "An active admin must record this reconciliation" unless @actor&.admin? && @actor.is_active?
      unless PayrollLockRollout.installation.cutoff_enforcement_starts_on == Date.new(2026, 10, 16)
        raise Error, "Expected the October 16 lock rollout"
      end
      raise Error, "Calendar inventory changed; stop for reviewed recovery" if PayrollCalendarPeriod.exists?
      actual = @plan.fetch("periods").map { |p| p.values_at("start_date", "end_date", "external_pay_period_id") }
      raise Error, "Expected paid regular runs 67, 76, 86, 94 in order" unless actual == PERIODS
      @plan.fetch("periods").each do |period|
        cutoff = Time.iso8601(period.fetch("cutoff_at"))
        processed = Time.iso8601(period.fetch("processed_at"))
        raise Error, "Invalid reviewed payment timestamps" unless cutoff <= processed && processed <= Time.current
      end
      adjustments = @plan.fetch("adjustment_entry_ids")
      notes = @plan.fetch("adjustment_notes")
      unless adjustments.keys.sort == %w[83 85] && adjustments.values.all? { |ids| ids.is_a?(Array) && ids.all? { |id| id.is_a?(Integer) && id.positive? } } &&
          %w[83 85].all? { |id| notes[id].to_s.strip.length >= 20 }
        raise Error, "Review exact AIRE source IDs and payment evidence for adjustments #83 and #85; document any adjustment with no source-hour coverage"
      end
      adjustments.values.flatten.each do |id|
        entry = legacy_entries.find { |candidate| candidate.id == id }
        unless entry && entry.work_date.between?(Date.new(2026, 9, 1), Date.new(2026, 9, 15))
          raise Error, "Adjustment entry must belong to September 1–15"
        end
      end
    end

    def validate_initial_inventory!
      raise Error, "Expected exactly the original August 1–15 batch" unless PayrollBatch.count == 1
      anchor = PayrollBatch.first
      unless anchor.start_date == Date.new(2026, 8, 1) && anchor.end_date == Date.new(2026, 8, 15) &&
          anchor.finalized_at.beginning_of_minute == Time.iso8601("2026-08-31T03:06:00Z") &&
          anchor.payroll_batch_entries.count == ANCHOR_ENTRY_COUNT && anchor.payroll_entry_processing_events.count == ANCHOR_ENTRY_COUNT
        raise Error, "Original batch inventory differs from the November 2 evidence"
      end
      events = anchor.payroll_batch_processing_events.order(:external_system).pluck(:status, :external_system, :external_pay_period_id)
      unless events == [ [ "committed", "cornerstone_payroll", "61" ], [ "committed", "cornerstone_payroll_manual", "61" ] ]
        raise Error, "Original processing evidence changed"
      end
    end

    def legacy_entries
      @legacy_entries ||= TimeEntry.joins(:user).merge(User.staff).where("work_date <= ?", Date.new(2026, 10, 15))
        .includes(:user, :time_entry_breaks).order(:id).to_a
    end

    def proposed_holds
      represented = PayrollBatchEntry.effective.pluck(:source_time_entry_id).to_set
      allocated = PayrollManualAllocation.active.pluck(:time_entry_id).to_set
      reported = PayrollPaymentAttestation.pending_evidence.pluck(:time_entry_id).to_set
      adjustments = @plan.fetch("adjustment_entry_ids").values.flatten.to_set
      legacy_entries.select do |entry|
        next false unless entry.counts_toward_hours?
        next false if represented.include?(entry.id) || allocated.include?(entry.id) || reported.include?(entry.id)

        period = @plan.fetch("periods").find { |p| entry.work_date.between?(Date.iso8601(p.fetch("start_date")), Date.iso8601(p.fetch("end_date"))) }
        period.nil? || adjustments.include?(entry.id) || entry.updated_at > Time.iso8601(period.fetch("cutoff_at"))
      end
    end

    def verify_receipt!(receipt)
      expected = receipt.metadata.fetch("batches")
      actual = PayrollBatch.where(public_id: expected.keys).pluck(:public_id, :checksum).to_h
      raise Error, "Recorded historical batches differ from the receipt" unless actual == expected && PayrollBatch.count == 5
      held_ids = receipt.metadata.fetch("hold_entry_ids")
      unless PayrollPaymentAttestation.where(time_entry_id: held_ids).count == held_ids.length
        raise Error, "Recorded historical holds differ from the receipt"
      end
      LegacyPaidHistoryGuard.check!
    end
  end
end
