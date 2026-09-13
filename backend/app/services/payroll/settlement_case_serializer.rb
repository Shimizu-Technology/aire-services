# frozen_string_literal: true

module Payroll
  class SettlementCaseSerializer
    def initialize(settlement_case)
      @settlement_case = settlement_case
    end

    def as_json
      entry = TimeEntry.includes(:user, :time_category).find_by(id: settlement_case.source_time_entry_id)
      snapshot = settlement_case.source_snapshot || {}
      {
        id: settlement_case.public_id,
        version: settlement_case.lock_version,
        source_time_entry_version: settlement_case.source_time_entry_version,
        status: settlement_case.status,
        source_time_entry_id: settlement_case.source_time_entry_id.to_s,
        employee: {
          payroll_integration_id: settlement_case.source_user_uuid || snapshot["user_uuid"],
          name: entry&.user&.full_name || snapshot["employee_name"] || "Former team member",
          email: entry&.user&.email || snapshot["employee_email"]
        }.compact,
        time: {
          original_work_date: settlement_case.original_work_date.iso8601,
          held_total_hours: settlement_case.held_total_hours.to_f,
          current_total_hours: entry&.hours&.to_f,
          category: category_for(entry, snapshot),
          approval_status: normalized_approval_status(entry),
          entry_status: entry&.status
        }.compact,
        origin: {
          reason: settlement_case.origin_reason,
          payroll_batch_id: settlement_case.origin_payroll_batch.public_id,
          payroll_period_id: settlement_case.origin_payroll_batch.payroll_calendar_period&.external_pay_period_id,
          excluded_at: settlement_case.origin_payroll_batch.cutoff_at.iso8601
        }.compact,
        routing: {
          destination_kind: settlement_case.destination_kind,
          target_external_pay_period_id: settlement_case.target_external_pay_period_id,
          target_pay_date: settlement_case.target_payroll_calendar_period&.pay_date&.iso8601,
          owner_role: settlement_case.owner_role,
          assigned_to: settlement_case.assigned_to && {
            payroll_integration_id: settlement_case.assigned_to.payroll_integration_uuid,
            name: settlement_case.assigned_to.full_name
          },
          action_due_on: settlement_case.action_due_on.iso8601,
          note: settlement_case.resolution_note
        }.compact,
        included_payroll_batch_id: settlement_case.included_payroll_batch&.public_id,
        processing: processing_status,
        events: settlement_case.payroll_settlement_case_events
          .sort_by { |event| [ event.occurred_at, event.id ] }
          .map { |event| serialize_event(event) }
      }.compact
    end

    private

    attr_reader :settlement_case

    def category_for(entry, snapshot)
      return { id: entry.time_category.id, key: entry.time_category.key, name: entry.time_category.name } if entry&.time_category

      snapshot["time_category"]
    end

    def normalized_approval_status(entry)
      return unless entry
      return "pending" if entry.manual_entry? && entry.approval_status.nil?

      entry.approval_status
    end

    def processing_status
      event = settlement_case.payroll_settlement_case_events
        .select { |candidate| candidate.event_type.in?(SettlementCaseAcknowledger::EVENT_TYPES) }
        .max_by { |candidate| [ candidate.occurred_at, candidate.id ] }
      return unless event

      {
        status: event.event_type,
        occurred_at: event.metadata["occurred_at"] || event.occurred_at.iso8601,
        external_pay_period_id: event.metadata["external_pay_period_id"],
        external_payroll_item_id: event.metadata["external_payroll_item_id"],
        payment_method: event.metadata["payment_method"],
        payment_reference: event.metadata["payment_reference"]
      }.compact
    end

    def serialize_event(event)
      {
        event_id: event.event_id,
        event_type: event.event_type,
        from_status: event.from_status,
        to_status: event.to_status,
        occurred_at: event.occurred_at.iso8601,
        actor: event.actor && {
          payroll_integration_id: event.actor_payroll_integration_uuid,
          name: event.actor.full_name
        },
        metadata: event.metadata
      }.compact
    end
  end
end
