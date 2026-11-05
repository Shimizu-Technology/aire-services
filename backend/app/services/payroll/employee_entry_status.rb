# frozen_string_literal: true

module Payroll
  # An allowlist projection of the same lifecycle used by manager reports.
  # Never serialize settlements, instrument references or payment reports here.
  class EmployeeEntryStatus
    LABELS = {
      "awaiting_approval" => "Not in payroll — awaiting approval",
      "not_payable" => "Not in payroll — time denied",
      "ready_for_cutoff" => "Approved — not paid yet",
      "finalized" => "In payroll — not paid yet",
      "imported" => "In payroll — not paid yet",
      "committed" => "In payroll — not paid yet",
      "payment_prepared" => "Check prepared — not paid yet",
      "payment_issued" => "Paid",
      "payment_failed" => "Payment needs attention",
      "payment_voided" => "Payment voided",
      "payment_cancelled" => "Payment cancelled",
      "partially_paid" => "Partly paid",
      "partially_prepared" => "Partly prepared — not fully paid",
      "partially_processed" => "Partly in payroll — not paid yet",
      "partially_allocated" => "Partly in payroll — not paid yet",
      "payment_attested_pending_evidence" => "On hold — payment confirmation pending",
      "held" => "On hold — awaiting payroll",
      "payment_history_unavailable" => "Payment history unavailable"
    }.freeze

    def initialize(entries:)
      @entries = Array(entries)
    end

    def call
      lifecycles = EntryLifecycleResolver.new(entries: @entries).call
      # The existing historical fence identifies older entries without inventing
      # a date boundary or treating a historical commit as issued payment.
      legacy_ids = @entries.empty? ? [] : LegacyPaidHistoryGuard.legacy_entry_ids(@entries.map(&:id))
      @entries.to_h do |entry|
        lifecycle = lifecycles.fetch(entry.id)
        status = lifecycle.fetch(:status)
        settlements = lifecycle.fetch(:settlements)
        if (status == "ready_for_cutoff" && legacy_ids.include?(entry.id) && settlements.empty?) ||
            (status == "committed" && settlements.any? && settlements.all? { |row| row[:legacy_processing] })
          status = "payment_history_unavailable"
        elsif lifecycle.fetch(:held_hours).positive? && settlements.empty? && status.in?(%w[ready_for_cutoff awaiting_approval])
          status = "held"
        end
        [ entry.id, {
          status: status,
          label: employee_label(entry, status),
          paid_hours: lifecycle.fetch(:paid_hours),
          held_hours: lifecycle.fetch(:held_hours)
        } ]
      end
    end

    private

    def employee_label(entry, status)
      return LABELS.fetch(status) unless status == "held"
      return "On hold — needs manager approval" if entry.approval_status == "pending" || (entry.manual_entry? && entry.approval_status.nil?)

      LABELS.fetch(status)
    end
  end
end
