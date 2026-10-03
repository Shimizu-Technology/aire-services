# frozen_string_literal: true

module Payroll
  class PaymentAttestationRecorder
    class Error < StandardError; end

    def initialize(actor:)
      @actor = actor
    end

    # An owner statement is a hold against accidental repayment, not proof of
    # a Cornerstone check or an AIRE "paid" event.
    def attest!(entry:, source_user_uuid:, reason:)
      explanation = reason.to_s.strip
      raise Error, "Explain who confirmed payment and why evidence is pending" if explanation.length < 20
      raise Error, "AIRE employee identity changed; refresh before attesting" unless entry.user&.staff? &&
        entry.user.payroll_integration_uuid == source_user_uuid.to_s.downcase
      raise Error, "Complete and approve this AIRE time entry first" unless entry.counts_toward_hours?
      raise Error, "This entry is already represented in an AIRE payroll batch" if PayrollBatchEntry.exists?(source_time_entry_id: entry.id)
      raise Error, "This entry already has a Cornerstone allocation" if PayrollManualAllocation.active.exists?(time_entry_id: entry.id)
      raise Error, "This entry already has a payment attestation" if PayrollPaymentAttestation.exists?(time_entry_id: entry.id)

      attestation = PayrollPaymentAttestation.create!(
        time_entry: entry,
        user: entry.user,
        recorded_by: @actor,
        source_user_uuid: entry.user.payroll_integration_uuid,
        source_time_entry_version: entry.lock_version,
        work_date: entry.work_date,
        hours: entry.hours,
        reason: explanation,
        attested_at: Time.current
      )
      attestation.payroll_payment_attestation_events.create!(
        actor: @actor, event_type: "attested", occurred_at: attestation.attested_at,
        reason: explanation
      )
      PayrollSettlementCase.active.where(source_time_entry_id: entry.id).lock.each do |settlement_case|
        SettlementCaseCoordinator.transition!(
          settlement_case,
          status: "superseded", resolved_at: Time.current,
          event_type: "superseded", actor: @actor,
          metadata: { reason: "owner_payment_attestation_pending_evidence", payment_attestation_id: attestation.id }
        )
      end
      attestation
    rescue ActiveRecord::RecordNotUnique
      raise Error, "This entry already has a payment attestation"
    end

    def retract!(attestation:, reason:)
      raise Error, "Only a pending attestation can be retracted" unless attestation.status == "pending_evidence"
      explanation = reason.to_s.strip
      raise Error, "Explain why the payment attestation is being retracted" if explanation.length < 20

      attestation.update!(
        status: "retracted", retracted_at: Time.current,
        retracted_by: @actor, retraction_reason: explanation
      )
      attestation.payroll_payment_attestation_events.create!(
        actor: @actor, event_type: "retracted", occurred_at: attestation.retracted_at,
        reason: explanation
      )
      attestation
    end
  end
end
