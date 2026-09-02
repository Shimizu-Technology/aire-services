# frozen_string_literal: true

module Payroll
  class BatchFinalizer
    ADVISORY_LOCK_KEY = 638_318_281
    LOCK_TIMEOUT = "5s"

    class FinalizationError < StandardError; end
    class ExistingBatchError < FinalizationError; end

    attr_reader :start_date, :end_date, :actor, :acknowledge_negative_adjustments, :negative_adjustment_note,
                :manual_processing, :cutoff_at, :processed_at, :external_pay_period_id, :processing_note,
                :acknowledge_missing_categories

    def initialize(start_date:, end_date:, actor:, acknowledge_negative_adjustments: false, negative_adjustment_note: nil,
                   manual_processing: false, cutoff_at: nil, processed_at: nil, external_pay_period_id: nil,
                   processing_note: nil, acknowledge_missing_categories: false)
      @start_date = parse_date!(start_date, "start_date")
      @end_date = parse_date!(end_date, "end_date")
      @actor = actor
      @acknowledge_negative_adjustments = ActiveModel::Type::Boolean.new.cast(acknowledge_negative_adjustments)
      @negative_adjustment_note = negative_adjustment_note.to_s.strip
      @manual_processing = ActiveModel::Type::Boolean.new.cast(manual_processing)
      @cutoff_at = parse_manual_time!(cutoff_at, "cutoff_at") if @manual_processing
      @processed_at = parse_manual_time!(processed_at, "processed_at") if @manual_processing
      @external_pay_period_id = external_pay_period_id.to_s.strip
      @processing_note = processing_note.to_s.strip
      @acknowledge_missing_categories = ActiveModel::Type::Boolean.new.cast(acknowledge_missing_categories)
      raise ArgumentError, "end_date must be on or after start_date" if @end_date < @start_date
      if (@end_date - @start_date).to_i > BatchBuilder::MAX_RANGE_DAYS
        raise ArgumentError, "date range may not exceed #{BatchBuilder::MAX_RANGE_DAYS} days"
      end
      validate_manual_processing_input! if @manual_processing
    end

    def call
      source_ledger_locked_at = nil
      outcome = "failed"
      batch = PayrollBatch.transaction do
        configure_lock_timeout!
        lock_finalization!
        lock_source_ledger!
        source_ledger_locked_at = Process.clock_gettime(Process::CLOCK_MONOTONIC)
        cutoff = manual_processing ? cutoff_at : Time.current
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
        record_manual_processing!(batch) if manual_processing
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
            negative_adjustment_note: negative_adjustment_note.presence,
            manual_processing: manual_processing,
            processing_note: processing_note.presence,
            external_pay_period_id: external_pay_period_id.presence,
            processed_at: processed_at&.iso8601
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

    def parse_date!(value, name)
      raise ArgumentError, "#{name} is required" if value.blank?

      Date.iso8601(value.to_s)
    rescue Date::Error
      raise ArgumentError, "#{name} must be a valid ISO 8601 date (YYYY-MM-DD)"
    end

    def parse_manual_time!(value, name)
      raise ArgumentError, "#{name} is required when recording manually processed payroll" if value.blank?

      begin
        Time.iso8601(value.to_s)
      rescue ArgumentError
        raise ArgumentError, "#{name} must be a valid ISO 8601 timestamp"
      end
    end

    def validate_manual_processing_input!
      raise ArgumentError, "cutoff_at cannot be in the future" if cutoff_at > Time.current
      raise ArgumentError, "processed_at cannot be before cutoff_at" if processed_at < cutoff_at
      raise ArgumentError, "processed_at cannot be in the future" if processed_at > Time.current
      raise ArgumentError, "Cornerstone pay period ID is required" if external_pay_period_id.blank?
      raise ArgumentError, "Processing note must be at least 10 characters" if processing_note.length < 10
    end

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
    # category IDs are already snapshotted on TimeEntry.
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
      best_effort { ActiveSupport::Notifications.instrument("payroll.source_ledger_blocking", details) }
      best_effort { Rails.logger.info(details.to_json) }
    end

    # Observability runs after the database transaction has committed. A broken
    # subscriber or log sink must never turn a successful finalization into an
    # apparent failure that an operator might retry.
    def best_effort
      yield
    rescue StandardError
      nil
    end

    def reject_overlapping_batch!
      overlap = PayrollBatch.where("start_date <= ? AND end_date >= ?", end_date, start_date).first
      return unless overlap

      raise ExistingBatchError, "Payroll batch #{overlap.public_id} already covers part of this period"
    end

    def validate_result!(result)
      issues = result.fetch(:issues)
      if issues.fetch(:missing_category_count).positive?
        unless manual_processing && acknowledge_missing_categories
          raise FinalizationError, "Resolve missing work categories before finalizing this payroll batch"
        end
      end
      return unless issues.fetch(:negative_adjustment_count).positive?
      return if acknowledge_negative_adjustments && negative_adjustment_note.present?

      raise FinalizationError, "Negative payroll corrections require acknowledgement and an explanatory note"
    end

    def record_manual_processing!(batch)
      event = batch.payroll_batch_processing_events.create!(
        event_id: "aire-manual-commit-#{batch.public_id}",
        status: "committed",
        occurred_at: processed_at,
        external_system: "cornerstone_payroll_manual",
        external_pay_period_id: external_pay_period_id,
        metadata: {
          recorded_by_user_id: actor.id,
          recorded_by_email: actor.email,
          note: processing_note,
          acknowledged_missing_categories: acknowledge_missing_categories
        }
      )
      AuditLog.record!(
        action: "payroll_batch.manually_processed",
        actor: actor,
        auditable: batch,
        event_category: "payroll",
        metadata: {
          event_id: event.event_id,
          status: event.status,
          cutoff_at: batch.cutoff_at.iso8601,
          processed_at: event.occurred_at.iso8601,
          external_system: event.external_system,
          external_pay_period_id: event.external_pay_period_id,
          note: processing_note,
          summary: batch.summary,
          issues: batch.issues
        }
      )
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
