# frozen_string_literal: true

module Payroll
  class CockpitCommand
    class ConflictError < StandardError; end
    class StaleObjectError < StandardError; end
    class InvalidCommandError < StandardError; end
    class DuplicateReceiptError < StandardError; end

    Result = Data.define(:body, :status, :replayed, :receipt)

    def initialize(command_id:, action:, actor:, target:, expected_version:, payload:)
      @command_id = command_id.to_s.strip.downcase
      @action = action
      @actor = actor
      @target = target
      @expected_version = begin
        Integer(expected_version.to_s, 10)
      rescue ArgumentError, TypeError
        raise InvalidCommandError, "expected_version must be a non-negative integer"
      end
      canonical_payload = payload.deep_stringify_keys.except("command_id", "expected_version")
      canonical_payload["reason"] = canonical_payload["reason"].to_s.strip if canonical_payload.key?("reason")
      canonical_payload["decision"] = canonical_payload["decision"].to_s.strip.downcase if canonical_payload.key?("decision")
      @request_checksum = CanonicalPayload.checksum(canonical_payload)
    end

    def call
      raise InvalidCommandError, "command_id must be a UUID" unless command_id.match?(PayrollIntegrationCommand::UUID_FORMAT)
      raise InvalidCommandError, "expected_version must be a non-negative integer" if expected_version.negative?

      existing = PayrollIntegrationCommand.find_by(command_id: command_id)
      return replay(existing) if existing

      receipt = nil
      body = nil
      concurrent_replay = nil
      ActiveRecord::Base.transaction do
        target.lock!
        existing = PayrollIntegrationCommand.find_by(command_id: command_id)
        if existing
          concurrent_replay = replay(existing)
          next
        end
        if target.lock_version != expected_version
          raise StaleObjectError, "This record changed in AIRE. Refresh it before trying again."
        end

        body, status, result_metadata = yield(target)
        receipt = create_receipt!(status: status, result_metadata: result_metadata)
      end

      return concurrent_replay if concurrent_replay

      Result.new(body: body, status: receipt.response_status, replayed: false, receipt: receipt)
    rescue DuplicateReceiptError
      replay(PayrollIntegrationCommand.find_by!(command_id: command_id))
    rescue StaleObjectError, ConflictError => e
      audit_failure(e)
      raise
    end

    private

    attr_reader :command_id, :action, :actor, :target, :expected_version, :request_checksum

    def replay(receipt)
      unless same_command?(receipt)
        raise ConflictError, "Command ID was already used for a different request"
      end

      Result.new(body: nil, status: receipt.response_status, replayed: true, receipt: receipt)
    end

    def create_receipt!(status:, result_metadata:)
      PayrollIntegrationCommand.create!(
        command_id: command_id,
        action: action,
        actor: actor,
        actor_payroll_integration_uuid: actor.payroll_integration_uuid,
        target_type: target.class.name,
        target_id: target.id,
        expected_version: expected_version,
        request_checksum: request_checksum,
        response_status: Rack::Utils.status_code(status),
        result_metadata: result_metadata
      )
    rescue ActiveRecord::RecordNotUnique
      raise DuplicateReceiptError
    end

    def same_command?(receipt)
      receipt.action == action &&
        receipt.actor_id == actor.id &&
        receipt.actor_payroll_integration_uuid == actor.payroll_integration_uuid &&
        receipt.target_type == target.class.name &&
        receipt.target_id == target.id &&
        receipt.expected_version == expected_version &&
        receipt.request_checksum == request_checksum
    end

    def audit_failure(error)
      AuditLog.record!(
        action: "payroll_cockpit.command_rejected",
        actor: actor,
        source: "integration",
        outcome: error.is_a?(StaleObjectError) || error.is_a?(ConflictError) ? "denied" : "failed",
        event_category: "payroll",
        auditable: target,
        metadata: {
          command_id: command_id,
          command_action: action,
          expected_version: expected_version,
          actual_version: target.reload.lock_version,
          error: error.message
        }
      )
    rescue StandardError => audit_error
      Rails.logger.warn("Payroll cockpit command rejection audit failed: #{audit_error.class}: #{audit_error.message}")
    end
  end
end
