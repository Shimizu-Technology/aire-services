# frozen_string_literal: true

class AllowSupplementalPayrollBatches < ActiveRecord::Migration[8.0]
  def up
    remove_index :payroll_batches, name: "index_payroll_batches_on_start_date_and_end_date"
    add_index :payroll_batches, [ :start_date, :end_date ], unique: true,
      name: "index_payroll_batches_on_start_date_and_end_date",
      where: "COALESCE(payload->>'purpose', 'regular') = 'regular'"
    add_index :payroll_batches, "(payload->>'target_external_pay_period_id')", unique: true,
      name: "index_payroll_batches_supplemental_target", where: "payload->>'purpose' = 'supplemental'"
  end

  def down
    if select_value("SELECT EXISTS (SELECT 1 FROM payroll_batches WHERE payload->>'purpose' = 'supplemental')")
      raise ActiveRecord::IrreversibleMigration, "Retain immutable supplemental payroll batches and roll forward"
    end
    remove_index :payroll_batches, name: "index_payroll_batches_supplemental_target"
    remove_index :payroll_batches, name: "index_payroll_batches_on_start_date_and_end_date"
    add_index :payroll_batches, [ :start_date, :end_date ], unique: true
  end
end
