# frozen_string_literal: true

module Payroll
  class BatchFinalizer
    ADVISORY_LOCK_KEY = 638_318_281
    LOCK_TIMEOUT = "5s"

    class FinalizationError < StandardError; end
    class ExistingBatchError < FinalizationError; end

    attr_reader :start_date, :end_date, :actor, :acknowledge_negative_adjustments, :negative_adjustment_note

    def initialize(start_date:, end_date:, actor:, acknowledge_negative_adjustments: false, negative_adjustment_note: nil)
      @start_date = start_date
      @end_date = end_date
      @actor = actor
      @acknowledge_negative_adjustments = ActiveModel::Type::Boolean.new.cast(acknowledge_negative_adjustments)
      @negative_adjustment_note = negative_adjustment_note.to_s.strip
    end

    def call
      source_ledger_locked_at = nil
      outcome = "failed"
      batch = PayrollBatch.transaction do
        configure_lock_timeout!
        lock_finalization!
        lock_source_ledger!
        source_ledger_locked_at = Process.clock_gettime(Process::CLOCK_MONOTONIC)
        cutoff = Time.current
        reference = build_reference(cutoff)
        reject_overlapping_batch!
        result = BatchBuilder.new(
          start_date: start_date,
          end_date: end_date,
          cutoff_at: cutoff,
          batch_reference: reference
        ).call
        validate_result!(result)
        payload = finalized_payload(result.fetch(:payload))
        checksum = CanonicalPayload.checksum(payload)
        batch = PayrollBatch.create!(
          public_id: reference,
          start_date: result.fetch(:start_date),
          end_date: result.fetch(:end_date),
          cutoff_at: cutoff,
          finalized_at: cutoff,
          finalized_by: actor,
          checksum: checksum,
          payload: payload,
          summary: result.fetch(:summary),
          issues: result.fetch(:issues)
        )
        result.fetch(:rows).each { |row| batch.payroll_batch_entries.create!(row) }
        result.fetch(:exclusions).each do |row|
          batch.payroll_batch_exclusions.create!(row.except(:work_date))
        end
        AuditLog.record!(
          action: "payroll_batch.finalized",
          actor: actor,
          auditable: batch,
          event_category: "payroll",
          metadata: {
            start_date: batch.start_date.iso8601,
            end_date: batch.end_date.iso8601,
            cutoff_at: batch.cutoff_at.iso8601,
            checksum: batch.checksum,
            summary: batch.summary,
            issues: batch.issues,
            negative_adjustment_note: negative_adjustment_note.presence
          }.compact
        )
        batch
      end
      outcome = "succeeded"
      batch
    rescue ActiveRecord::LockWaitTimeout
      raise FinalizationError, "Time tracking is busy. Wait a moment and finalize this payroll batch again."
    ensure
      record_source_ledger_blocking_window(source_ledger_locked_at, outcome) if source_ledger_locked_at
    end

    private

    def configure_lock_timeout!
      quoted_timeout = ActiveRecord::Base.connection.quote(LOCK_TIMEOUT)
      ActiveRecord::Base.connection.execute("SET LOCAL lock_timeout = #{quoted_timeout}")
    end

    def lock_finalization!
      ActiveRecord::Base.connection.execute("SELECT pg_advisory_xact_lock(#{ADVISORY_LOCK_KEY})")
    end

    # A finalized batch must represent one coherent instant. The short-lived
    # SHARE locks let in-flight ledger writes finish, then prevent new time or
    # break writes until the immutable snapshot and audit event are committed.
    # User/category labels remain readable without blocking their writers; the
    # pay-critical category and rate IDs are already snapshotted on TimeEntry.
    def lock_source_ledger!
      ActiveRecord::Base.connection.execute(
        "LOCK TABLE time_entries, time_entry_breaks IN SHARE MODE"
      )
    end

    def record_source_ledger_blocking_window(started_at, outcome)
      duration_ms = ((Process.clock_gettime(Process::CLOCK_MONOTONIC) - started_at) * 1000).round(1)
      details = {
        event: "payroll.source_ledger_blocking",
        outcome: outcome,
        duration_ms: duration_ms,
        start_date: start_date.to_s,
        end_date: end_date.to_s
      }
      ActiveSupport::Notifications.instrument("payroll.source_ledger_blocking", details)
      Rails.logger.info(details.to_json)
    end

    def reject_overlapping_batch!
      overlap = PayrollBatch.where("start_date <= ? AND end_date >= ?", end_date, start_date).first
      return unless overlap

      raise ExistingBatchError, "Payroll batch #{overlap.public_id} already covers part of this period"
    end

    def validate_result!(result)
      issues = result.fetch(:issues)
      if issues.values_at(:missing_category_count, :missing_rate_count).any?(&:positive?)
        raise FinalizationError, "Resolve missing work categories and pay rates before finalizing this payroll batch"
      end
      return unless issues.fetch(:negative_adjustment_count).positive?
      return if acknowledge_negative_adjustments && negative_adjustment_note.present?

      raise FinalizationError, "Negative payroll corrections require acknowledgement and an explanatory note"
    end

    def finalized_payload(payload)
      payload.deep_dup.merge(
        finalized_by: {
          id: actor.id,
          name: actor.full_name,
          email: actor.email
        },
        negative_adjustment_acknowledgement: negative_adjustment_note.presence
      ).compact
    end

    def build_reference(cutoff)
      "AIRE-PAY-#{cutoff.strftime('%Y%m%d')}-#{SecureRandom.hex(6).upcase}"
    end
  end
end
