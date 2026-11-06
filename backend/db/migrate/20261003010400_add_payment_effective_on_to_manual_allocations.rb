# frozen_string_literal: true

class AddPaymentEffectiveOnToManualAllocations < ActiveRecord::Migration[8.1]
  def up
    add_column :payroll_manual_allocations, :payment_effective_on, :date
    add_column :payroll_manual_allocation_events, :payment_effective_on, :date

    # Older issued allocations did not distinguish the physical payment date
    # from the time the event was recorded. Leave those dates unknown; do not
    # manufacture historical payment evidence from an audit timestamp.
  end

  def down
    remove_column :payroll_manual_allocation_events, :payment_effective_on
    remove_column :payroll_manual_allocations, :payment_effective_on
  end
end
