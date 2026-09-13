# frozen_string_literal: true

module Payroll
  class SettlementCaseAcknowledger
    EVENT_TYPES = %w[
      imported committed payment_prepared payment_issued payment_failed payment_voided
      payment_returned settled
    ].freeze
    TRANSITIONS = {
      nil => %w[imported],
      "imported" => %w[committed],
      "committed" => %w[payment_prepared],
      "payment_prepared" => %w[payment_issued payment_failed payment_voided],
      "payment_issued" => %w[settled payment_returned payment_voided],
      "payment_failed" => %w[payment_prepared],
      "payment_voided" => %w[payment_prepared],
      "payment_returned" => %w[payment_prepared],
      "settled" => []
    }.freeze

    class AcknowledgementError < StandardError; end

    def initialize(settlement_case:, event_type:, occurred_at:, actor:, metadata:)
      @settlement_case = settlement_case
      @event_type = event_type.to_s.strip
      @occurred_at = parse_time(occurred_at)
      @actor = actor
      @metadata = metadata.to_h.compact
    end

    def call
      raise AcknowledgementError, "event_type is not supported" unless event_type.in?(EVENT_TYPES)
      if settlement_case.destination_kind == "unassigned" || settlement_case.status.in?(%w[not_payable superseded])
        raise AcknowledgementError, "Route this case to a payroll before acknowledging processing"
      end
      unless settlement_case.destination_kind == "supplemental"
        raise AcknowledgementError, "Acknowledge regular payroll processing on the payroll batch entry"
      end

      previous_event = latest_processing_event
      previous_event_type = previous_event&.event_type
      unless event_type.in?(TRANSITIONS.fetch(previous_event_type, []))
        expected = TRANSITIONS.fetch(previous_event_type, []).to_sentence
        current = previous_event_type || "no processing event"
        raise AcknowledgementError, "Cannot record #{event_type} after #{current}; record #{expected.presence || 'no further events'} next"
      end
      if previous_event && occurred_at < previous_event.occurred_at
        raise AcknowledgementError, "occurred_at cannot be earlier than the previous processing event"
      end

      status = event_type == "settled" ? "settled" : "in_payroll"
      Payroll::SettlementCaseCoordinator.transition!(
        settlement_case,
        status: status,
        resolved_at: event_type == "settled" ? occurred_at : nil,
        event_type: event_type,
        actor: actor,
        occurred_at: occurred_at,
        metadata: metadata.merge(occurred_at: occurred_at.iso8601)
      )
    end

    private

    attr_reader :settlement_case, :event_type, :occurred_at, :actor, :metadata

    def latest_processing_event
      settlement_case.payroll_settlement_case_events
        .where(event_type: EVENT_TYPES)
        .order(id: :desc)
        .first
    end

    def parse_time(value)
      raise AcknowledgementError, "occurred_at is required" if value.blank?

      Time.iso8601(value.to_s)
    rescue ArgumentError
      raise AcknowledgementError, "occurred_at must be a valid ISO 8601 timestamp"
    end
  end
end
