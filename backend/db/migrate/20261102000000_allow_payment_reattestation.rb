# frozen_string_literal: true

class AllowPaymentReattestation < ActiveRecord::Migration[8.1]
  def change
    add_index :time_entries, [ :work_date, :id ], where: "status = 'completed' AND approval_status = 'approved'",
      name: "idx_time_entries_legacy_payable_history"
    remove_index :payroll_payment_attestations, :time_entry_id, unique: true
    add_index :payroll_payment_attestations, :time_entry_id
    add_index :payroll_payment_attestations, :time_entry_id, unique: true,
      where: "status <> 'retracted'", name: "idx_payment_attestations_current_entry"
  end
end
