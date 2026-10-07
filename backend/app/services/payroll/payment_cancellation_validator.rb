# frozen_string_literal: true

module Payroll
  class PaymentCancellationValidator
    def self.validate_replacement!(batch_entry:, attributes:, occurred_at:, source_user_uuid:)
      cancellations = batch_entry.payroll_batch.payroll_entry_processing_events.where(
        status: "payment_cancelled", source_time_entry_id: batch_entry.source_time_entry_id,
        source_line_key: batch_entry.line_key, source_user_uuid: batch_entry.source_user_uuid,
        external_system: attributes[:external_system], external_pay_period_id: attributes[:external_pay_period_id],
        external_payroll_item_id: attributes[:external_payroll_item_id]
      ).to_a
      return if cancellations.empty?

      if cancellations.any? { |event| event.payment_method == attributes[:payment_method] && event.payment_reference == attributes[:payment_reference] }
        raise EntryProcessingSummary::LineConflictError, "Cancelled instruments cannot be issued again; use the replacement payment reference"
      end
      if occurred_at < cancellations.map(&:occurred_at).max
        raise EntryProcessingSummary::LineConflictError, "Replacement receipt cannot precede payment cancellation"
      end
      unless attributes[:contract_version] == PayrollEntryProcessingEvent::LINE_CONTRACT_VERSION &&
             source_user_uuid.present? && source_user_uuid == batch_entry.source_user_uuid &&
             attributes[:payment_method].present? && attributes[:payment_reference].present?
        raise EntryProcessingSummary::LineConflictError, "Replacement receipt requires exact frozen line identity and payment reference"
      end
    end

    def self.call!(batch_entry:, attributes:, occurred_at:, metadata:, source_user_uuid:)
      unless attributes[:contract_version] == PayrollEntryProcessingEvent::LINE_CONTRACT_VERSION &&
             source_user_uuid.present? && source_user_uuid == batch_entry.source_user_uuid
        raise EntryProcessingSummary::LineConflictError, "Payment cancellation requires exact frozen line and employee identity"
      end
      previous_id = metadata["cancelled_payment_event_id"].to_s
      evidence = metadata["cancellation_evidence_reference"]
      if previous_id.blank? || !evidence.is_a?(String) || evidence.strip.blank? || evidence.length > 200
        raise ArgumentError, "Payment cancellation requires the original receipt and cancellation evidence reference"
      end
      events = batch_entry.payroll_batch.payroll_entry_processing_events.where(
        source_time_entry_id: batch_entry.source_time_entry_id, source_line_key: batch_entry.line_key,
        source_user_uuid: source_user_uuid, external_system: attributes[:external_system],
        external_pay_period_id: attributes[:external_pay_period_id],
        external_payroll_item_id: attributes[:external_payroll_item_id]
      ).to_a
      previous = PayrollEntryProcessingEvent.latest(events)
      unless previous && previous.event_id == previous_id && previous.status.in?(%w[payment_prepared payment_issued]) &&
             previous.line_contract? && previous.payment_method.present? && previous.payment_reference.present? &&
             previous.payment_method == attributes[:payment_method] && previous.payment_reference == attributes[:payment_reference]
        raise EntryProcessingSummary::LineConflictError, "Original payment receipt is stale or does not match this exact instrument"
      end
      known_date = previous.metadata["payment_effective_on"].presence
      if known_date && known_date.to_s != metadata["payment_effective_on"].to_s
        raise EntryProcessingSummary::LineConflictError, "Original payment date does not match its retained receipt"
      end
      metadata["original_payment_effective_on_known"] = known_date.present?
      metadata["original_payment_effective_on"] = known_date
      unless attributes[:occurred_at].to_s.match?(/(?:Z|[+-]\d{2}:\d{2})\z/i)
        raise ArgumentError, "Payment cancellation requires a timestamp with an explicit UTC offset"
      end
      raise ArgumentError, "Payment cancellation cannot precede its original receipt" if occurred_at < previous.occurred_at
      raise ArgumentError, "Payment cancellation cannot be recorded at a future time" if occurred_at > Time.current
    end
  end
end
