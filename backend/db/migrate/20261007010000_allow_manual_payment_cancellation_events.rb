# frozen_string_literal: true

class AllowManualPaymentCancellationEvents < ActiveRecord::Migration[8.1]
  SETTLEMENT_EVENT_TYPES = %w[opened routed rerouted corrected approval_changed included imported committed
    payment_prepared payment_issued payment_failed payment_voided payment_returned settled marked_not_payable superseded].freeze

  def up
    add_column :payroll_manual_allocations, :payment_cancelled_at, :datetime
    add_column :payroll_manual_allocation_events, :cancellation_evidence_reference, :string
    replace_settlement_event_constraint(SETTLEMENT_EVENT_TYPES + [ "payment_cancelled" ])
    remove_check_constraint :payroll_manual_allocation_events, name: "check_payroll_manual_allocation_events_type"
    add_check_constraint :payroll_manual_allocation_events,
                         "event_type IN ('committed', 'issued', 'voided', 'payment_cancelled')",
                         name: "check_payroll_manual_allocation_events_type"
  end

  def down
    replace_settlement_event_constraint(SETTLEMENT_EVENT_TYPES)
    remove_column :payroll_manual_allocations, :payment_cancelled_at
    remove_column :payroll_manual_allocation_events, :cancellation_evidence_reference
    remove_check_constraint :payroll_manual_allocation_events, name: "check_payroll_manual_allocation_events_type"
    add_check_constraint :payroll_manual_allocation_events,
                         "event_type IN ('committed', 'issued', 'voided')",
                         name: "check_payroll_manual_allocation_events_type"
  end

  private

  def replace_settlement_event_constraint(types)
    remove_check_constraint :payroll_settlement_case_events, name: "check_payroll_settlement_case_events_type"
    add_check_constraint :payroll_settlement_case_events,
                         "event_type IN (#{types.map { |type| "'#{type}'" }.join(', ')})",
                         name: "check_payroll_settlement_case_events_type"
  end
end
