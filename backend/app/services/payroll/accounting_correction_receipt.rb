# frozen_string_literal: true

module Payroll
  # Read-only interpretation of an exact noncash receipt. This is not payment
  # evidence, recovery evidence, or a new processing/settlement transition.
  class AccountingCorrectionReceipt
    IDS = %w[correction_disposition_id original_pay_period_id original_payroll_item_id corrective_pay_period_id corrective_payroll_item_id].freeze
    METADATA_KEYS = (IDS + [ "accounting_only" ]).freeze
    LABEL = "Accounting correction committed"
    NOTE = "No new payment or recovery recorded. Original payment history remains separate."

    def self.context(row:, event:)
      return unless event && event.line_contract? && event.status == "committed" &&
        event.external_system == "cornerstone_payroll" && row.source_kind == "correction" && row.total_hours.finite? && row.total_hours.negative? &&
        event.payroll_batch_id == row.payroll_batch_id && event.source_time_entry_id == row.source_time_entry_id &&
        event.source_line_key == row.line_key && event.source_kind == row.source_kind &&
        row.source_user_uuid.present? && event.source_user_uuid == row.source_user_uuid &&
        %i[total_hours regular_hours overtime_hours].all? { |key| event.public_send(key) == row.public_send(key) } &&
        event.payment_method.blank? && event.payment_reference.blank?

      metadata = event.metadata
      return unless metadata.is_a?(Hash) && metadata["accounting_only"] == true &&
        (metadata.keys - METADATA_KEYS).empty? && IDS.all? { |key| metadata[key].is_a?(String) && metadata[key].match?(/\A[1-9]\d{0,18}\z/) && metadata[key].to_i <= 9_223_372_036_854_775_807 } &&
        metadata["corrective_pay_period_id"] == event.external_pay_period_id &&
        metadata["corrective_payroll_item_id"] == event.external_payroll_item_id &&
        metadata["original_pay_period_id"] != metadata["corrective_pay_period_id"] &&
        metadata["original_payroll_item_id"] != metadata["corrective_payroll_item_id"]

      metadata.slice(*IDS).merge("accounting_only" => true)
    end
  end
end
