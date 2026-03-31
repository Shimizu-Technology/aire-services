# frozen_string_literal: true

class CreatePayrollImportBatches < ActiveRecord::Migration[8.1]
  def change
    create_table :payroll_import_batches do |t|
      t.string :idempotency_key, null: false
      t.string :source_payroll_run_id, null: false
      t.jsonb :payload, null: false, default: {}
      t.decimal :total_gross, precision: 12, scale: 2
      t.decimal :total_net, precision: 12, scale: 2
      t.decimal :total_tax, precision: 12, scale: 2
      t.integer :employee_count
      t.string :status, null: false, default: "pending"
      t.text :error_message
      t.jsonb :reconciliation_details, default: {}
      t.timestamps
    end

    add_index :payroll_import_batches, :idempotency_key, unique: true
    add_index :payroll_import_batches, :source_payroll_run_id
    add_index :payroll_import_batches, :status
    add_index :payroll_import_batches, :created_at
  end
end
