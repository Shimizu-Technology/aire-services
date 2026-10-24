# frozen_string_literal: true

module Payroll
  class ScheduledCutoffFinalizer
    include RetrySchedule

    BATCH_AUTHORIZATION = Object.new.freeze
    private_constant :BATCH_AUTHORIZATION

    class << self
      def call_due(now: Time.current)
        reconcile_settlement_cases_safely
        PayrollCalendarPeriod.due_at(now).order(:cutoff_at, :id).pluck(:id).map do |period_id|
          new(period_id: period_id, now: now, reconcile_settlement_cases: false).call
        end
      end

      def reconcile_settlement_cases_safely
        SettlementCaseCoordinator.sync_finalized_periods!
      rescue StandardError => e
        Rails.error.report(
          e,
          handled: true,
          severity: :warning,
          context: { operation: "settlement_case_reconciliation" }
        )
        Rails.logger.error("Payroll settlement reconciliation failed: #{e.class}: #{e.message}")
        nil
      end
    end

    attr_reader :period_id, :now

    def initialize(period_id:, now: Time.current, reconcile_settlement_cases: true)
      @period_id = period_id
      @now = now
      @reconcile_settlement_cases = reconcile_settlement_cases
    end

    def call
      self.class.reconcile_settlement_cases_safely if reconcile_settlement_cases
      batch = finalize_transaction!
      { period_id: period_id, status: batch ? "finalized" : "skipped", payroll_batch_id: batch&.public_id }
    rescue StandardError => e
      record_failure!(e)
      { period_id: period_id, status: "failed", error: e.message }
    end

    private

    attr_reader :reconcile_settlement_cases

    def finalize_transaction!
      PayrollCalendarPeriod.transaction(requires_new: true) do
        period = PayrollCalendarPeriod.lock("FOR UPDATE SKIP LOCKED").find_by(id: period_id)
        return nil unless period
        return period.payroll_batch if period.status == "finalized"
        return nil unless eligible_mode?(period)
        return nil unless due?(period)

        batch = BatchFinalizer.new(
          start_date: period.start_date,
          end_date: period.end_date,
          **batch_options(period),
          calendar_authorization: BATCH_AUTHORIZATION,
          calendar_period: period
        ).call
        period.update!(
          status: "finalized",
          payroll_batch: batch,
          finalized_at: batch.finalized_at,
          finalization_attempts: period.finalization_attempts + 1,
          last_finalization_attempt_at: now,
          next_finalization_attempt_at: nil,
          last_finalization_error: nil
        )
        create_outbox_event!(period, batch)
        record_success_audit!(period, batch)
        batch
      end
    end

    def eligible_mode?(period)
      period.scheduled_lock_enforced?
    end

    def batch_options(period)
      { actor: nil, cutoff_at: period.cutoff_at.iso8601(6), automated_cutoff: true }
    end

    def audit_actor
      nil
    end

    def audit_metadata
      {}
    end

    def due?(period)
      return false if period.cutoff_at > now
      return true if period.status == "scheduled"

      period.status == "failed" && period.next_finalization_attempt_at.present? && period.next_finalization_attempt_at <= now
    end

    def create_outbox_event!(period, batch)
      event_id = SecureRandom.uuid
      period.payroll_outbox_events.create!(
        event_id: event_id,
        event_type: "payroll_batch.finalized",
        occurred_at: batch.finalized_at,
        next_delivery_attempt_at: now,
        payload: {
          schema_version: "1.0",
          event_id: event_id,
          event_type: "payroll_batch.finalized",
          occurred_at: batch.contract_finalized_at,
          source: "aire_services",
          payroll_period: period.as_contract_json(now: now),
          payroll_batch: {
            id: batch.public_id,
            checksum: batch.checksum,
            schema_version: batch.schema_version,
            start_date: batch.start_date.iso8601,
            end_date: batch.end_date.iso8601,
            cutoff_at: batch.contract_cutoff_at,
            finalized_at: batch.contract_finalized_at,
            summary: batch.summary,
            issues: batch.issues
          }
        }
      )
    end

    def record_success_audit!(period, batch)
      AuditLog.record!(
        action: "payroll_calendar_period.finalized",
        actor: audit_actor,
        actor_kind: audit_actor ? "user" : "system",
        source: audit_actor ? "integration" : "system",
        event_category: "payroll",
        auditable: period,
        metadata: {
          **audit_metadata,
          lock_mode: period.lock_mode,
          snapshot_cutoff_at: batch.contract_cutoff_at,
          external_pay_period_id: period.external_pay_period_id,
          schedule_version: period.schedule_version,
          cutoff_at: period.cutoff_at.iso8601,
          payroll_batch_id: batch.public_id,
          checksum: batch.checksum,
          summary: batch.summary,
          issues: batch.issues
        }
      )
    end

    def record_failure!(error)
      attempts = nil
      external_period_id = nil
      PayrollCalendarPeriod.transaction(requires_new: true) do
        period = PayrollCalendarPeriod.lock.find(period_id)
        return if period.status == "finalized"

        attempts = period.finalization_attempts + 1
        external_period_id = period.external_pay_period_id
        retryable = !error.is_a?(BatchFinalizer::OutOfOrderFinalizationError) &&
          !error.is_a?(BatchBuilder::PolicyUnavailableError) &&
          !error.is_a?(TimeEntryRevisionLedger::CoverageError) &&
          !error.is_a?(ManualAllocationLedger::CoverageError)
        period.update!(
          status: "failed",
          finalization_attempts: attempts,
          last_finalization_attempt_at: now,
          next_finalization_attempt_at: retryable ? now + retry_delay(attempts) : nil,
          last_finalization_error: safe_error(error)
        )
        AuditLog.record!(
          action: "payroll_calendar_period.finalization_failed",
          actor: audit_actor,
          actor_kind: audit_actor ? "user" : "system",
          source: audit_actor ? "integration" : "system",
          event_category: "payroll",
          outcome: "failed",
          auditable: period,
          metadata: {
            **audit_metadata,
            external_pay_period_id: period.external_pay_period_id,
            schedule_version: period.schedule_version,
            cutoff_at: period.cutoff_at.iso8601,
            attempt: attempts,
            retry_at: period.next_finalization_attempt_at&.iso8601,
            retryable: retryable,
            error_class: error.class.name,
            error: safe_error(error)
          }
        )
      end
      report_repeated_failure!(
        record_type: "PayrollCalendarPeriod",
        record_id: external_period_id,
        attempts: attempts,
        error: error
      )
    rescue ActiveRecord::RecordNotFound
      nil
    end
  end
end
