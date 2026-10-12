# frozen_string_literal: true

module Payroll
  class PaymentAttestationResolution
    class Error < StandardError; end
    EVENT_METHODS = { "delivered_check" => "paper_check", "direct_deposit_confirmation" => "direct_deposit" }.freeze

    def initialize(actor:)
      @actor = actor
    end

    # API-only recorder: CockpitCommand must already hold the evidence advisory
    # lock, Source SHARE locks and attestation lock. The nested transaction is
    # for rollback; it is not a standalone authorization or concurrency fence.
    def resolve!(attestation:, source_time_entry_id:, source_time_entry_version:, source_user_uuid:, work_date:,
                 regular_hours:, overtime_hours:, external_pay_period_id:, external_payroll_item_id:, pay_date:,
                 payment_method:, payment_reference:, payment_effective_on:, occurred_at:,
                 payroll_payment_event_type:, payroll_payment_event_id:, expected_weekly_context_fingerprint:, reason:)
      ApplicationRecord.transaction do
        entry = TimeEntry.lock.find(attestation.time_entry_id)
        entry.association(:user).target = User.lock.find(entry.user_id)
        attestation.association(:time_entry).target = entry
        attestation.association(:user).target = entry.user
        unless attestation.status == "pending_evidence" && entry.id.to_s == source_time_entry_id.to_s &&
            entry.lock_version.to_s == source_time_entry_version.to_s &&
            attestation.source_time_entry_version.to_s == source_time_entry_version.to_s &&
            attestation.source_user_uuid == source_user_uuid && attestation.work_date.iso8601 == work_date
          raise Error, "Payment report source identity or version changed; refresh and keep the hold for review"
        end
        explanation = reason.to_s.strip
        raise Error, "Explain the exact existing payment match in at least 20 characters" if explanation.length < 20
        unless EVENT_METHODS[payroll_payment_event_type] == payment_method
          raise Error, "Use existing delivered-check or confirmed bank-payment evidence"
        end
        event_id = payroll_payment_event_id.to_s
        unless event_id.present? && event_id == event_id.strip && event_id.length <= 200
          raise Error, "The original saved Payroll payment event is required"
        end
        context = PaymentAttestationResolutionContext.new(attestation: attestation).snapshot!
        unless expected_weekly_context_fingerprint.to_s.match?(/\A[0-9a-f]{64}\z/) &&
            expected_weekly_context_fingerprint == context.fetch(:weekly_context_fingerprint)
          raise CockpitCommand::StaleObjectError, "The reported source week changed. Refresh its exact payment evidence before matching."
        end
        unless exact_hours?(regular_hours, context.fetch(:regular_hours)) && exact_hours?(overtime_hours, context.fetch(:overtime_hours))
          raise Error, "Match the complete exact regular and overtime hours shown by Source; partial or reclassified coverage needs review"
        end

        recorder = ManualAllocationRecorder.new(actor: @actor)
        allocation = recorder.commit_reported_payment!(attestation: attestation, entry: entry,
          source_user_uuid: source_user_uuid, regular_hours: regular_hours, overtime_hours: overtime_hours,
          external_pay_period_id: external_pay_period_id, external_payroll_item_id: external_payroll_item_id,
          pay_date: pay_date, reason: explanation)
        expected_allocation_version = allocation.lock_version
        recorder.issue!(allocation: allocation, payment_method: payment_method, payment_reference: payment_reference,
          payment_effective_on: payment_effective_on, occurred_at: occurred_at, reason: explanation)
        issued_event = allocation.payroll_manual_allocation_events.where(event_type: "issued").order(:id).last!
        attestation.update!(status: "resolved", resolved_at: Time.current, resolved_by: @actor,
          resolution_reason: explanation, resolved_manual_allocation: allocation, resolved_issued_event: issued_event,
          resolution_evidence: { expected_weekly_context_fingerprint: expected_weekly_context_fingerprint,
            payroll_payment_event_type: payroll_payment_event_type, payroll_payment_event_id: event_id })
        attestation.payroll_payment_attestation_events.create!(actor: @actor, event_type: "resolved",
          occurred_at: attestation.resolved_at, reason: explanation)
        SettlementCaseCoordinator.resolve_attestation_cases!(attestation: attestation, actor: @actor)
        { allocation: allocation, issued_event: issued_event, expected_allocation_version: expected_allocation_version }
      end
    rescue PaymentAttestationResolutionContext::Error => e
      raise Error, e.message
    end

    private

    def exact_hours?(value, expected)
      amount = BigDecimal(value.to_s)
      amount.finite? && amount >= 0 && amount.round(2) == amount && amount == BigDecimal(expected)
    rescue ArgumentError, TypeError
      false
    end
  end
end
