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
      PayrollBatch.transaction(requires_new: true) do
        connection = ActiveRecord::Base.connection
        connection.execute("SET LOCAL lock_timeout = '5s'")
        connection.execute("SELECT pg_advisory_xact_lock(#{CalendarPeriodPublisher::ADVISORY_LOCK_KEY})")
        connection.execute("SELECT pg_advisory_xact_lock(#{BatchFinalizer::ADVISORY_LOCK_KEY})")
        connection.execute("LOCK TABLE time_entries, time_entry_breaks, payroll_time_entry_revisions, payroll_manual_allocations, payroll_payment_attestations, payroll_settlement_cases, time_categories, user_time_categories IN SHARE MODE")
        @legacy_entries = nil
        @payable_entry_ids = nil
        @split_entries = nil
        @actor&.reload
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
          partial_coverage_entry_ids: @partial_coverage_entry_ids.to_a.sort,
          owed_entry_ids: owed_entry_ids,
          uncovered_pending_by_user: uncovered_pending_by_user,
          periods: @plan.fetch("periods"),
          entries: legacy_entries.map { |entry| [ entry.id, entry.attributes, entry.user.attributes.slice("id", "first_name", "last_name", "email", "role", "payroll_integration_uuid", "is_active"), entry.time_entry_breaks.map(&:attributes) ] },
          context_entries: TimeEntry.where(work_date: rollout_starts_on..(rollout_starts_on + 5.days)).includes(:time_entry_breaks).order(:id)
            .map { |entry| [ entry.attributes, entry.time_entry_breaks.map(&:attributes) ] },
          categories: TimeCategory.order(:id).map(&:attributes),
          category_assignments: UserTimeCategory.order(:id).map(&:attributes),
          actor: @actor.attributes.slice("id", "first_name", "last_name", "email", "role", "is_active"),
          allocations: PayrollManualAllocation.order(:id).map(&:attributes),
          attestations: PayrollPaymentAttestation.order(:id).map(&:attributes),
          settlement_cases: PayrollSettlementCase.order(:id).map(&:attributes),
          batches: PayrollBatch.order(:id).map(&:attributes)
        }
        digest = CanonicalPayload.checksum(report)
        unless apply
          preview = report.except(:entries, :context_entries, :categories, :category_assignments, :actor, :allocations, :attestations, :settlement_cases, :batches)
            .merge(status: "preview", preview_digest: digest, split_entry_ids: split_entries.map(&:id))
          begin
            PayrollBatch.transaction(requires_new: true) do
              preview.merge!(execute!(holds, plan_checksum, digest).slice(:batch_checksums, :owed_entry_ids))
              raise ActiveRecord::Rollback
            end
          rescue StandardError => e
            preview.merge!(status: "preview_failed", error: "#{e.class}: #{e.message}")
          end
          return preview
        end
        raise Error, "State changed or preview digest missing; preview and review again" unless expected_digest == digest

        execute!(holds, plan_checksum, digest)
      end
    end

    private

    def execute!(holds, plan_checksum, digest)
      if @partial_coverage_entry_ids.any?
        raise Error, "Partial historical coverage requires exact reconciliation before release: #{@partial_coverage_entry_ids.to_a.sort.join(', ')}"
      end
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
          excluded_source_entry_ids: owed_entry_ids + legacy_entries.reject { |entry| entry.approval_status == "approved" }.map(&:id),
          manual_batch_reference: "AIRE-HISTORY-#{period.fetch('external_pay_period_id')}-#{plan_checksum.first(16)}",
          acknowledge_missing_categories: @plan.fetch("acknowledge_missing_categories", false),
          processing_note: "Release reconciliation of paid regular run ##{period.fetch('external_pay_period_id')}; #83/#85 adjustments and changed/older source hours held for exact evidence."
        ).call
      end
      @plan.fetch("owed_entry_ids", []).each do |id|
        LegacyHistoryCaseReview.capture!(TimeEntry.find(id), actor: @actor,
          reason: "Release evidence confirms these source hours were not paid; explicitly route the owed correction to the first connected payroll or reconcile an exact manual allocation.")
      end
      uncovered = LegacyPaidHistoryGuard.uncovered_entries.where(approval_status: "approved").where.not(id: owed_entry_ids)
      raise Error, "Historical entries remain uncovered: #{uncovered.limit(20).pluck(:id).join(', ')}" if uncovered.exists?
      checksums = batches.to_h { |batch| [ batch.public_id, batch.checksum ] }
      receipt = AuditLog.record!(action: ACTION, actor: @actor, auditable: PayrollLockRollout.installation, event_category: "payroll",
        metadata: { plan_checksum: plan_checksum, preview_checksum: digest, hold_entry_ids: holds.map(&:id),
          owed_entry_ids: owed_entry_ids, batches: checksums })
      { status: "applied", receipt_id: receipt.id, batches: batches.map(&:public_id), batch_checksums: checksums,
        held_count: holds.length, owed_entry_ids: owed_entry_ids }
    end

    def owed_entry_ids
      @plan.fetch("owed_entry_ids", [])
    end

    def split_entries
      @split_entries ||= legacy_entries.select do |entry|
        dates = PayableIntervals.segments(entry).map { |segment| segment[:work_date] }
        # Include even represented Aug 15 overnight work in the preview. It is
        # never pulled into the following manual range for a second payment.
        @plan.fetch("periods").any? do |period|
          start_date, end_date = period.values_at("start_date", "end_date")
          range = Date.iso8601(start_date)..Date.iso8601(end_date)
          dates.any? { |date| range.cover?(date) } && dates.any? { |date| !range.cover?(date) }
        end
      end
    end

    def validate_environment_state!
      raise Error, "Keep connected payroll paused" if ConnectedPayrollMode.enabled?
      raise Error, "An active admin must record this reconciliation" unless @actor&.admin? && @actor.is_active?
      unless PayrollLockRollout.installation.cutoff_enforcement_starts_on == rollout_starts_on
        raise Error, "Expected the reviewed lock rollout boundary"
      end
      raise Error, "Calendar inventory changed; stop for reviewed recovery" if PayrollCalendarPeriod.exists?
      actual = @plan.fetch("periods").map { |p| p.values_at("start_date", "end_date", "external_pay_period_id") }
      unless actual.first(PERIODS.length) == PERIODS
        raise Error, "Expected paid regular runs 67, 76, 86, 94 in order"
      end
      next_start = Date.new(2026, 10, 16)
      @plan.fetch("periods").drop(PERIODS.length).each do |period|
        from = Date.iso8601(period.fetch("start_date"))
        to = from.day == 16 ? from.end_of_month : from.change(day: 15)
        unless from == next_start && period.fetch("end_date") == to.iso8601 &&
            period.fetch("external_pay_period_id").match?(/\A[1-9]\d*\z/) &&
            period["manual_run_evidence"].to_s.strip.length >= 20
          raise Error, "Additional manual periods require contiguous complete ranges and reviewed run evidence"
        end
        next_start = to + 1.day
      end
      unless next_start == rollout_starts_on && actual.map(&:last).uniq.length == actual.length
        raise Error, "Manual history must end immediately before the reviewed rollout, without duplicate runs"
      end
      @plan.fetch("periods").each do |period|
        cutoff = Time.iso8601(period.fetch("cutoff_at"))
        processed = Time.iso8601(period.fetch("processed_at"))
        raise Error, "Invalid reviewed payment timestamps" unless cutoff <= processed && processed <= Time.current
      end
      unless owed_entry_ids.is_a?(Array) && owed_entry_ids.all? { |id| id.is_a?(Integer) && id.positive? } && owed_entry_ids.uniq == owed_entry_ids
        raise Error, "owed_entry_ids must contain unique positive integer source IDs"
      end
      owed_entry_ids.each do |id|
        source = legacy_entries.find { |entry| entry.id == id }
        unless source && payable_entry_ids.include?(source.id) && source.approval_status == "approved" &&
            !PayrollBatchEntry.effective.exists?(source_time_entry_id: id) && !PayrollManualAllocation.active.exists?(time_entry_id: id) &&
            !PayrollPaymentAttestation.pending_evidence.exists?(time_entry_id: id)
          raise Error, "Owed entry #{id} must be approved, unrepresented and without payment holds or allocations"
        end
      end
      unless [ true, false ].include?(@plan.fetch("acknowledge_missing_categories", false))
        raise Error, "acknowledge_missing_categories must be a boolean"
      end
      if @plan["acknowledge_missing_categories"] && @plan["missing_category_note"].to_s.strip.length < 20
        raise Error, "Explain the reviewed missing-category evidence before acknowledging it"
      end
      adjustments = @plan.fetch("adjustment_entry_ids")
      notes = @plan.fetch("adjustment_notes")
      unless adjustments.keys.sort == %w[83 85] && adjustments.values.all? { |ids| ids.is_a?(Array) && ids.all? { |id| id.is_a?(Integer) && id.positive? } } &&
          %w[83 85].all? { |id| notes[id].to_s.strip.length >= 20 }
        raise Error, "Review exact AIRE source IDs and payment evidence for adjustments #83 and #85; document any adjustment with no source-hour coverage"
      end
      raise Error, "Owed entries cannot also be adjustment-paid entries" if (adjustments.values.flatten & owed_entry_ids).any?
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

    def rollout_starts_on
      Date.iso8601(@plan.fetch("rollout_starts_on", "2026-10-16"))
    end

    def legacy_entries
      @legacy_entries ||= TimeEntry.joins(:user).merge(User.staff).where("work_date <= ?", rollout_starts_on - 1.day)
        .includes(:user, :time_entry_breaks).order(:id).to_a
    end

    def payable_entry_ids
      @payable_entry_ids ||= LegacyPaidHistoryGuard.payable_entries.pluck(:id).to_set
    end

    def uncovered_pending_by_user
      LegacyPaidHistoryGuard.uncovered_entries.where(approval_status: nil)
        .group("time_entries.user_id", "users.first_name", "users.last_name").order("time_entries.user_id")
        .pluck("time_entries.user_id", "users.first_name", "users.last_name",
          Arel.sql("COUNT(*)"), Arel.sql("MIN(time_entries.work_date)"), Arel.sql("MAX(time_entries.work_date)"))
        .map do |user_id, first_name, last_name, count, from, to|
          { user_id: user_id, name: [ first_name, last_name ].join(" "), count: count,
            start_date: from.iso8601, end_date: to.iso8601 }
        end
    end

    def proposed_holds
      represented = PayrollBatchEntry.effective.pluck(:source_time_entry_id).to_set
      allocated = PayrollManualAllocation.active.pluck(:time_entry_id).to_set
      reported = PayrollPaymentAttestation.pending_evidence.pluck(:time_entry_id).to_set
      adjustments = @plan.fetch("adjustment_entry_ids").values.flatten.to_set
      splits = split_entries.map(&:id).to_set
      uncovered = LegacyPaidHistoryGuard.uncovered_entries.where(approval_status: "approved").pluck(:id).to_set
      @partial_coverage_entry_ids = uncovered & (represented | allocated)
      legacy_entries.select do |entry|
        next false unless uncovered.include?(entry.id)
        next false if owed_entry_ids.include?(entry.id)
        next false if represented.include?(entry.id) || allocated.include?(entry.id) || reported.include?(entry.id)

        period = @plan.fetch("periods").find { |p| entry.work_date.between?(Date.iso8601(p.fetch("start_date")), Date.iso8601(p.fetch("end_date"))) }
        period.nil? || splits.include?(entry.id) || adjustments.include?(entry.id) || entry.updated_at > Time.iso8601(period.fetch("cutoff_at"))
      end
    end

    def verify_receipt!(receipt)
      expected = receipt.metadata.fetch("batches")
      actual = PayrollBatch.where(public_id: expected.keys).pluck(:public_id, :checksum).to_h
      raise Error, "Recorded historical batches differ from the receipt" unless actual == expected && PayrollBatch.count == @plan.fetch("periods").length + 1
      held_ids = receipt.metadata.fetch("hold_entry_ids")
      unless PayrollPaymentAttestation.pending_evidence.where(time_entry_id: held_ids).distinct.count(:time_entry_id) == held_ids.length
        raise Error, "Recorded historical holds differ from the receipt"
      end
      missing_cases = receipt.metadata.fetch("owed_entry_ids", []).reject { |id| PayrollSettlementCase.exists?(source_time_entry_id: id, origin_reason: "legacy_history_review") }
      raise Error, "Recorded owed correction cases are missing" if missing_cases.any?
    end
  end
end
