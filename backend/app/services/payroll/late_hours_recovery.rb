# frozen_string_literal: true

module Payroll
  # Executed by CockpitCommand under the same finalizer/source-ledger locks as
  # claiming. A terminal record fences both the original command and its target,
  # including a delayed original request that has not arrived yet.
  class LateHoursRecovery
    def initialize(period:, actor:)
      @period = period
      @actor = actor
    end

    def recover!(source_command_id:, parameters:)
      original, target, retirement, receipt, batch = lookup!(source_command_id, parameters)
      status = retirement&.status || (batch ? "claimed" : "no_claim")
      unless retirement || batch
        retire!(original, target, "no_claim", parameters.fetch(:reason))
      end
      audit!("recovered", original, target, status, receipt, batch, parameters.fetch(:reason))
      metadata = { status: status, original_command_id: original }
      metadata.merge!(payroll_batch_id: batch.public_id, export: receipt.result_metadata.fetch("export")) if status == "claimed"
      metadata
    end

    def cancel!(source_command_id:, parameters:)
      unless parameters[:confirm_unapplied] == true && parameters[:expected_batch_id].present?
        raise CockpitCommand::InvalidCommandError, "expected_batch_id and confirm_unapplied: true are required"
      end
      original, target, retirement, receipt, batch = lookup!(source_command_id, parameters)
      unless batch && batch.public_id == parameters[:expected_batch_id]
        raise CockpitCommand::ConflictError, "The original claim does not match expected_batch_id"
      end
      if retirement
        raise CockpitCommand::ConflictError, "The original command has no accepted claim" unless retirement.status == "canceled"
        return { status: "canceled", original_command_id: original }
      end

      rows = batch.payroll_batch_entries.to_a
      cases = PayrollSettlementCase.where(included_payroll_batch: batch).order(:id).lock.to_a
      ids = rows.map(&:source_time_entry_id).uniq
      unless cases.any? && cases.map(&:source_time_entry_id).sort == ids.sort && cases.all? { |item|
          item.status == "in_payroll" && item.destination_kind == "supplemental" &&
            item.target_external_pay_period_id == target && item.origin_payroll_batch_id == period.payroll_batch_id
        }
        raise CockpitCommand::ConflictError, "The original cases no longer belong exclusively to this claim"
      end
      financial_types = %w[imported committed payment_prepared payment_issued payment_failed payment_voided payment_returned payment_cancelled settled]
      if batch.payroll_entry_processing_events.exists? || batch.payroll_batch_processing_events.exists? ||
          PayrollObligationCorrection.where(payroll_batch_entry_id: rows.map(&:id)).exists? ||
          PayrollSettlementCaseEvent.where(payroll_settlement_case_id: cases.map(&:id), event_type: financial_types).exists? ||
          PayrollBatchEntry.effective.where(source_time_entry_id: ids).where.not(payroll_batch: batch).exists? ||
          PayrollManualAllocation.active.where(time_entry_id: ids).exists? ||
          PayrollPaymentAttestation.pending_evidence.where(time_entry_id: ids).exists? ||
          PayrollSettlementCase.active.where(source_time_entry_id: ids).where.not(id: cases.map(&:id)).where.not(destination_kind: "unassigned").exists?
        raise CockpitCommand::ConflictError, "This claim has processing evidence or another active owner and cannot be canceled"
      end

      retire!(original, target, "canceled", parameters.fetch(:reason), batch)
      cases.each do |item|
        SettlementCaseCoordinator.transition!(item, status: "open", destination_kind: "unassigned",
          target_payroll_calendar_period: nil, target_external_pay_period_id: nil, included_payroll_batch: nil,
          resolved_at: nil, resolution_note: parameters.fetch(:reason), event_type: "rerouted", actor: actor,
          metadata: { requires_explicit_routing: true, canceled_payroll_batch_id: batch.public_id,
            original_command_id: original, reason: parameters.fetch(:reason) })
      end
      audit!("canceled", original, target, "canceled", receipt, batch, parameters.fetch(:reason))
      { status: "canceled", original_command_id: original }
    end

    def self.response(metadata)
      metadata = metadata.deep_stringify_keys
      terminal = PayrollLateHoursRetirement.find_by(original_command_id: metadata.fetch("original_command_id"))
      status = terminal&.status || metadata.fetch("status")
      body = { status: status }
      if status == "claimed"
        batch = PayrollBatch.find_by!(public_id: metadata.fetch("payroll_batch_id"))
        body[:payroll_batch] = batch.payload.deep_dup.merge("export" => metadata.fetch("export"))
      end
      body
    end

    private

    attr_reader :period, :actor

    def lookup!(source_command_id, parameters)
      original = source_command_id.to_s.downcase
      target = parameters[:target_external_pay_period_id]
      unless original.match?(PayrollIntegrationCommand::UUID_FORMAT) && original != parameters[:command_id].to_s.downcase
        raise CockpitCommand::InvalidCommandError, "source_command_id must be the original, distinct command UUID"
      end
      unless target.is_a?(String) && target.match?(/\A[1-9]\d*\z/)
        raise CockpitCommand::InvalidCommandError, "target_external_pay_period_id must be a positive integer string"
      end
      unless period.status == "finalized" && period.payroll_batch && period.payroll_batch.payload["purpose"] != "supplemental"
        raise CockpitCommand::ConflictError, "Recovery requires the original finalized regular period"
      end
      retirements = PayrollLateHoursRetirement.where(original_command_id: original)
        .or(PayrollLateHoursRetirement.where(target_external_pay_period_id: target)).to_a
      retirement = retirements.first
      if retirements.any? { |item| item.original_command_id != original || item.target_external_pay_period_id != target || item.origin_payroll_calendar_period_id != period.id }
        raise CockpitCommand::ConflictError, "The original command, origin and destination do not match the terminal record"
      end
      receipt = PayrollIntegrationCommand.find_by(command_id: original)
      if receipt && (receipt.action != LateHours::ACTION || receipt.target_type != "PayrollCalendarPeriod" || receipt.target_id != period.id)
        raise CockpitCommand::ConflictError, "The original command belongs to a different action or origin"
      end
      batch = PayrollBatch.find_by(public_id: receipt.result_metadata["payroll_batch_id"]) if receipt
      target_batch = PayrollBatch.where("payload->>'purpose' = 'supplemental' AND payload->>'target_external_pay_period_id' = ?", target).first
      if (receipt && (!batch || batch.payload["purpose"] != "supplemental" ||
          batch.payload["target_external_pay_period_id"] != target || batch.payload["origin_payroll_batch_id"] != period.payroll_batch.public_id)) ||
          (target_batch && target_batch != batch) || (retirement && retirement.payroll_batch_id != batch&.id)
        raise CockpitCommand::ConflictError, "The original command does not identify this immutable source claim and destination"
      end
      [ original, target, retirement, receipt, batch ]
    end

    def retire!(original, target, status, reason, batch = nil)
      PayrollLateHoursRetirement.create!(original_command_id: original, target_external_pay_period_id: target,
        origin_payroll_calendar_period: period, payroll_batch: batch, actor: actor, status: status, reason: reason)
    end

    def audit!(verb, original, target, status, receipt, batch, reason)
      AuditLog.record!(action: "payroll_late_hours.#{verb}", actor: actor, source: "integration", event_category: "payroll",
        auditable: period, metadata: { original_command_id: original, target_external_pay_period_id: target,
          status: status, original_actor_id: receipt&.actor_id, payroll_batch_id: batch&.public_id, reason: reason })
    end
  end
end
