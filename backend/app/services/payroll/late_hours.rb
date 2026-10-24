# frozen_string_literal: true

module Payroll
  # A selection is a full unpaid source entry, including every payable date.
  # No compensation/rates are created here; Payroll owns those dimensions.
  class LateHours
    ACTION = "payroll_period.late_hours"
    MAX_CASES = 250

    def initialize(period:, actor: nil)
      @period = period
      @actor = actor
    end

    def candidates
      return [] unless finalized_origin?

      eligible = candidate_scope.order(:id).to_a
      result = build(eligible)
      eligible.filter_map do |settlement_case|
        next unless clear_of_pending_cutoff?(settlement_case)

        serialize(settlement_case, result)
      end
    end

    # Called only inside CockpitCommand's finalizer advisory/source-ledger locks.
    def create!(parameters)
      target = parameters[:target_external_pay_period_id]
      unless target.is_a?(String) && target.match?(/\A[1-9]\d*\z/)
        raise CockpitCommand::InvalidCommandError, "target_external_pay_period_id must be a positive integer string"
      end
      if PayrollBatch.where("payload->>'purpose' = 'supplemental' AND payload->>'target_external_pay_period_id' = ?", target).exists?
        raise CockpitCommand::ConflictError, "This adjustment already has a supplemental batch. Reuse its original command."
      end
      pay_date = Date.iso8601(parameters[:pay_date].to_s)
      unless pay_date.iso8601 == parameters[:pay_date]
        raise CockpitCommand::InvalidCommandError, "pay_date must use YYYY-MM-DD"
      end
      selections = parameters[:cases]
      unless selections.is_a?(Array) && selections.size.between?(1, MAX_CASES)
        raise CockpitCommand::InvalidCommandError, "Select between 1 and #{MAX_CASES} cases"
      end
      unless selections.all? { |item| item.is_a?(Hash) && item.key?(:id) && item.key?(:version) }
        raise CockpitCommand::InvalidCommandError, "Cases must each include id and version"
      end
      ids = selections.map { |item| item.fetch(:id).to_s }
      raise CockpitCommand::InvalidCommandError, "Select each case only once" unless ids.uniq.size == ids.size
      versions = selections.to_h do |item|
        version = item.fetch(:version)
        unless version.is_a?(Integer) && version >= 0
          raise CockpitCommand::InvalidCommandError, "Case versions must be non-negative integers"
        end
        [ item.fetch(:id).to_s, version ]
      end
      selected = PayrollSettlementCase.where(public_id: ids).order(:id).lock.to_a
      unless finalized_origin? && selected.size == ids.size &&
          selected.all? { |item| candidate_scope.exists?(id: item.id) && item.lock_version == versions.fetch(item.public_id) }
        raise CockpitCommand::ConflictError, "Selected late hours changed or are already reserved. Refresh before trying again."
      end
      selected.each { |item| validate_pending_cutoff!(item) }
      result = build(selected, reference: "AIRE-SUP-#{SecureRandom.uuid}")
      unless selected.all? { |item| serialize(item, result) }
        raise CockpitCommand::ConflictError, "Selected hours are no longer fully approved and payable. Refresh before trying again."
      end
      payload = result.fetch(:payload).merge(
        purpose: "supplemental", target_external_pay_period_id: target, pay_date: pay_date.iso8601,
        origin_external_pay_period_id: period.external_pay_period_id, origin_payroll_batch_id: period.payroll_batch.public_id,
        finalized_by: { id: actor.id, name: actor.full_name, email: actor.email }
      )
      batch = PayrollBatch.create!(public_id: payload.fetch(:batch_id), start_date: result.fetch(:start_date),
        end_date: result.fetch(:end_date), cutoff_at: result.fetch(:cutoff_at), finalized_at: result.fetch(:cutoff_at),
        finalized_by: actor, allocation_contract_version: payload.fetch(:allocation_contract_version),
        checksum: CanonicalPayload.checksum(payload), payload: payload, summary: result.fetch(:summary), issues: result.fetch(:issues))
      selected.each do |item|
        SettlementCaseRouter.new(settlement_case: item, destination_kind: "supplemental", target_external_pay_period_id: target,
          action_due_on: pay_date, assigned_to_id: nil, reason: parameters.fetch(:reason), actor: actor).call
      end
      result.fetch(:rows).each { |row| batch.payroll_batch_entries.create!(row) }
      selected.each do |item|
        SettlementCaseCoordinator.transition!(item, status: "in_payroll", included_payroll_batch: batch,
          event_type: "included", actor: actor, metadata: { payroll_batch_id: batch.public_id, reason: parameters.fetch(:reason) })
      end
      AuditLog.record!(action: "payroll_batch.supplemental_finalized", actor: actor, source: "integration", event_category: "payroll",
        auditable: batch, metadata: { origin_payroll_batch_id: period.payroll_batch.public_id,
          target_external_pay_period_id: target, case_ids: ids, reason: parameters.fetch(:reason), checksum: batch.checksum })
      batch
    rescue Date::Error
      raise CockpitCommand::InvalidCommandError, "pay_date must use YYYY-MM-DD"
    end

    private

    attr_reader :period, :actor

    def finalized_origin?
      period.status == "finalized" && period.payroll_batch && period.payroll_batch.payload["purpose"] != "supplemental"
    end

    def candidate_scope
      PayrollSettlementCase.where(origin_payroll_batch: period.payroll_batch, status: "open", destination_kind: "unassigned",
        included_payroll_batch_id: nil)
        .where.not(source_time_entry_id: PayrollBatchEntry.select(:source_time_entry_id))
        .where.not(source_time_entry_id: PayrollManualAllocation.active.select(:time_entry_id))
        .where.not(source_time_entry_id: PayrollPaymentAttestation.pending_evidence.select(:time_entry_id))
        .where.not(source_time_entry_id: PayrollSettlementCase.active.where.not(destination_kind: "unassigned").select(:source_time_entry_id))
    end

    def build(cases, reference: "PREVIEW")
      BatchBuilder.new(start_date: period.start_date, end_date: period.end_date, cutoff_at: Time.current,
        batch_reference: reference, source_entry_ids: cases.map(&:source_time_entry_id)).call
    end

    def clear_of_pending_cutoff?(item)
      validate_pending_cutoff!(item)
      true
    rescue CockpitCommand::ConflictError
      false
    end

    def validate_pending_cutoff!(item)
      entry = TimeEntry.find_by(id: item.source_time_entry_id)
      PendingCutoffClaimGuard.call!(entry: entry) if entry
    rescue PendingCutoffClaimGuard::ConflictError => e
      raise CockpitCommand::ConflictError, e.message
    end

    def serialize(item, result)
      rows = result.fetch(:rows).select { |row| row[:source_time_entry_id] == item.source_time_entry_id }
      return unless rows.any? && result.fetch(:exclusions).none? { |row| row[:source_time_entry_id] == item.source_time_entry_id }
      return unless rows.all? do |row|
        row[:source_kind] == "carryover" && row[:source_user_id] == item.source_user_id && row[:source_user_uuid].present? &&
          row[:source_user_uuid] == item.source_user_uuid && row[:source_category_id].present? &&
          row[:snapshot]["work_date"] == item.original_work_date.iso8601 &&
          row[:total_hours].positive? && row[:regular_hours] >= 0 && row[:overtime_hours] >= 0
      end
      return unless rows.sum { |row| row[:total_hours] } == rows.first[:snapshot]["hours"].to_d

      employee = result.fetch(:payload).fetch(:employees).find { |row| row[:source_user_id] == item.source_user_id.to_s }
      { id: item.public_id, version: item.lock_version,
        employee: { payroll_integration_id: item.source_user_uuid, source_user_id: item.source_user_id.to_s,
          name: employee[:display_name], email: employee[:email] },
        reason: reason_for(item), adjustments: employee.fetch(:adjustments).select { |row| row[:source_time_entry_id] == item.source_time_entry_id.to_s },
        total_hours: rows.sum { |row| row[:total_hours] }.to_f,
        regular_hours: rows.sum { |row| row[:regular_hours] }.to_f,
        overtime_hours: rows.sum { |row| row[:overtime_hours] }.to_f }
    end

    def reason_for(item)
      { "pending_approval" => "Approved after the original payroll cutoff",
        "approved_after_cutoff" => "Approved after the original payroll cutoff",
        "created_after_cutoff" => "Submitted after the original payroll cutoff",
        "open_clock" => "Clock-out completed after the original payroll cutoff",
        "manual_reservation_released" => "Previous manual payroll reservation was released" }
        .fetch(item.origin_reason, "Approved unpaid hours held from the original payroll")
    end
  end
end
