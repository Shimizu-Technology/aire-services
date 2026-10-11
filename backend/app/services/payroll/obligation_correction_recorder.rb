# frozen_string_literal: true

module Payroll
  class ObligationCorrectionRecorder
    CONTRACT = "payroll_obligation_correction_v1"
    COMMAND_KEYS = %w[contract command_id source_instance_id batch_checksum source_work_date source_time_entry_version predecessor successor financial_assertion].freeze
    PREDECESSOR_KEYS = %w[external_pay_period_id external_payroll_item_id payment_voided_event_id].freeze
    SUCCESSOR_KEYS = %w[external_pay_period_id external_payroll_item_id].freeze
    ASSERTION_IDS = %w[root_pay_period_id voided_pay_period_id successor_pay_period_id predecessor_payroll_item_id successor_payroll_item_id void_event_id correction_created_event_id successor_committed_event_id].freeze
    ASSERTION_KEYS = (ASSERTION_IDS + %w[version kind reversal_posting_ids]).freeze

    def self.call!(row:, attributes:, occurred_at:)
      new(row, attributes, occurred_at).call!
    end

    def self.digest_for(attributes:, occurred_at:)
      new(nil, attributes, occurred_at).send(:request_digest)
    end

    def initialize(row, attributes, occurred_at)
      @row = row
      @attributes = attributes.to_h.deep_stringify_keys
      @occurred_at = occurred_at
    end

    def call!
      command = attributes["obligation_correction"]
      return ordinary_owner! unless command

      require!(row.total_hours.finite? && row.total_hours.positive? && row.regular_hours >= 0 && row.overtime_hours >= 0, "Financial succession requires positive unchanged frozen work")
      exact_line!
      shape!(command, COMMAND_KEYS)
      predecessor = command.fetch("predecessor")
      successor = command.fetch("successor")
      assertion = command.fetch("financial_assertion")
      shape!(predecessor, PREDECESSOR_KEYS)
      shape!(successor, SUCCESSOR_KEYS)
      shape!(assertion, ASSERTION_KEYS)
      require!(command["contract"] == CONTRACT && command["command_id"].is_a?(String) && command["command_id"].match?(IntegrationProfile::UUID_PATTERN), "Unsupported obligation correction command")
      require!(command["source_instance_id"] == IntegrationProfile.source_instance_id && command["batch_checksum"] == row.payroll_batch.checksum, "Frozen batch installation or checksum changed")
      require!(command["source_work_date"] == row.work_date.iso8601 && command["source_time_entry_version"].is_a?(Integer) && command["source_time_entry_version"] >= 0 && command["source_time_entry_version"] == row.snapshot["version"], "Frozen work identity changed")
      require!(attributes["status"] == "committed" && attributes["contract_version"] == PayrollEntryProcessingEvent::LINE_CONTRACT_VERSION && attributes["source_user_uuid"] == row.source_user_uuid && attributes["payment_method"].blank? && attributes["payment_reference"].blank? && attributes["payment_effective_on"].blank? && (attributes["metadata"] || {}).is_a?(Hash) && (attributes["metadata"] || {}).empty?, "Successor binding is a committed receipt, not payment or accounting evidence")
      require!(successor == attributes.slice(*SUCCESSOR_KEYS) && successor.values.all? { |value| native_id?(value) } && predecessor.slice(*SUCCESSOR_KEYS).values.all? { |value| native_id?(value) } && predecessor["external_pay_period_id"] != successor["external_pay_period_id"] && predecessor["external_payroll_item_id"] != successor["external_payroll_item_id"], "Successor payroll identity does not match")
      require!(assertion["version"] == 1 && assertion["kind"] == "whole_payroll_void_and_corrective_commit" && ASSERTION_IDS.all? { |key| native_id?(assertion[key]) } && assertion["reversal_posting_ids"].is_a?(Array) && assertion["reversal_posting_ids"].any? && assertion["reversal_posting_ids"].uniq == assertion["reversal_posting_ids"] && assertion["reversal_posting_ids"].all? { |id| native_id?(id) }, "Complete authenticated financial correction assertion required")
      require!(assertion["voided_pay_period_id"] == predecessor["external_pay_period_id"] && assertion["predecessor_payroll_item_id"] == predecessor["external_payroll_item_id"] && assertion["successor_pay_period_id"] == successor["external_pay_period_id"] && assertion["successor_payroll_item_id"] == successor["external_payroll_item_id"], "Financial assertion does not bind the payroll owners")
      proof_ids = assertion.values_at("void_event_id", "correction_created_event_id", "successor_committed_event_id")
      require!(proof_ids.uniq.size == 3 && assertion["root_pay_period_id"] != assertion["successor_pay_period_id"], "Financial correction proof events must be distinct")
      digest = request_digest
      existing = PayrollObligationCorrection.find_by(command_id: command["command_id"])
      if existing
        require!(existing.payroll_batch_entry_id == row.id && existing.request_digest == digest && existing.command == command, "Correction command already belongs to different work")
        return existing
      end
      entry = TimeEntry.lock.find_by(id: row.source_time_entry_id)
      require!(entry && entry.user_id == row.source_user_id && entry.user.staff? && entry.user.payroll_integration_uuid == row.source_user_uuid && entry.work_date == row.work_date && entry.lock_version == command["source_time_entry_version"] && entry.counts_toward_hours?, "Current source work changed; review its correction separately")
      require!(occurred_at <= Time.current, "Successor receipt cannot be in the future")
      event = events.find { |candidate| candidate.event_id == predecessor["payment_voided_event_id"] }
      require!(event && event.line_contract? && event.source_line_key == row.line_key && event.source_kind == row.source_kind && event.status == "payment_voided" && event.source_user_uuid == row.source_user_uuid && event.external_system == attributes["external_system"] && event.external_pay_period_id == predecessor["external_pay_period_id"] && event.external_payroll_item_id == predecessor["external_payroll_item_id"] && %i[total_hours regular_hours overtime_hours].all? { |key| event.public_send(key) == row.public_send(key) }, "Retained exact financial predecessor void receipt required")
      known_owners = owner_tuples
      require!(events.any?(&:payroll_obligation_correction_id) || known_owners.one?, "Legacy frozen line has ambiguous payroll owners; review rather than reassign")
      current = PayrollEntryProcessingEvent.latest(events)
      require!(current&.id == event.id && occurred_at >= event.occurred_at, "Predecessor is no longer the current voided owner")
      require!(!PayrollObligationCorrection.exists?(predecessor_event_id: event.id), "Voided owner already has a successor")
      begin
        PayrollObligationCorrection.create!(payroll_batch_entry: row, predecessor_event: event,
          command_id: command["command_id"], request_digest: digest, external_system: attributes.fetch("external_system"),
          successor_pay_period_id: successor["external_pay_period_id"], successor_payroll_item_id: successor["external_payroll_item_id"], command: command)
      rescue ActiveRecord::RecordNotUnique
        raise EntryProcessingSummary::LineConflictError, "Correction command or predecessor already has a successor"
      end
    end

    private

    attr_reader :row, :attributes, :occurred_at

    def events
      @events ||= row.payroll_batch.payroll_entry_processing_events.where(source_time_entry_id: row.source_time_entry_id, source_line_key: [ row.line_key, nil ]).includes(:payroll_obligation_correction).to_a
    end

    def exact_line!
      require!(attributes["contract_version"] == PayrollEntryProcessingEvent::LINE_CONTRACT_VERSION && attributes["source_line_key"] == row.line_key && attributes["source_user_uuid"] == row.source_user_uuid, "Corrective receipts require exact v2 frozen line and employee identity")
      exact = %w[total_hours regular_hours overtime_hours].all? do |key|
        value = BigDecimal(attributes.fetch(key).to_s)
        value.finite? && value == row.public_send(key)
      end
      require!(exact, "Corrective receipts require finite exact frozen REG/OT and total hours")
    rescue ArgumentError, KeyError
      raise EntryProcessingSummary::LineConflictError, "Corrective receipts require finite exact frozen REG/OT and total hours"
    end

    def owner_tuples
      events.filter_map do |candidate|
        [ candidate.external_system, candidate.external_pay_period_id, candidate.external_payroll_item_id ] if candidate.external_pay_period_id.present? && candidate.external_payroll_item_id.present?
      end.uniq
    end

    def ordinary_owner!
      owner = PayrollObligationCorrection.where(payroll_batch_entry: row).order(:id).last
      if owner
        exact_line!
        require!(!attributes["status"].in?(%w[imported committed]), "Corrective commitment requires its original typed command")
        require!(attributes["external_system"] == owner.external_system && attributes["external_pay_period_id"] == owner.successor_pay_period_id && attributes["external_payroll_item_id"] == owner.successor_payroll_item_id, "This frozen line belongs to its validated corrective payroll owner")
        current = PayrollEntryProcessingEvent.latest(events)
        require!(!(current&.status == "payment_voided" && attributes["status"] != "payment_voided"), "Voided corrective owners cannot be revived")
        require!(!(current&.status.in?(%w[payment_prepared payment_issued payment_cancelled]) && attributes["status"].in?(%w[imported committed])), "A delayed receipt cannot regress the corrective owner")
        return owner
      end
      current = PayrollEntryProcessingEvent.latest(events)
      if current&.status == "payment_voided"
        same = current.external_system == attributes["external_system"] && current.external_pay_period_id == attributes["external_pay_period_id"] && current.external_payroll_item_id == attributes["external_payroll_item_id"]
        require!(same && attributes["status"] == "payment_voided", "A voided frozen owner requires a validated financial successor")
      end
      if attributes["contract_version"] == PayrollEntryProcessingEvent::LINE_CONTRACT_VERSION && current&.external_payroll_item_id.present?
        known_owners = owner_tuples
        require!(known_owners.one? && known_owners.first == attributes.values_at("external_system", "external_pay_period_id", "external_payroll_item_id"), "Unproved or ambiguous alternate frozen-line owner")
      end
      nil
    end

    def request_digest
      payload = attributes.except("payment_method", "payment_reference", "payment_effective_on")
      payload["source_time_entry_id"] = payload["source_time_entry_id"].to_s
      payload["occurred_at"] = occurred_at.utc.iso8601(6)
      %w[total_hours regular_hours overtime_hours].each { |key| payload[key] = BigDecimal(payload.fetch(key).to_s).to_s("F") }
      payload["metadata"] ||= {}
      CanonicalPayload.checksum(payload)
    end

    def native_id?(value)
      value.is_a?(String) && value.match?(/\A[1-9]\d{0,18}\z/) && value.to_i <= 9_223_372_036_854_775_807
    end

    def shape!(value, keys)
      require!(value.is_a?(Hash) && value.keys.sort == keys.sort, "Complete typed obligation correction fields required")
    end

    def require!(condition, message)
      raise EntryProcessingSummary::LineConflictError, message unless condition
    end
  end
end
