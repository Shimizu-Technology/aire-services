# frozen_string_literal: true

class CreatePayrollManualAllocations < ActiveRecord::Migration[8.0]
  def change
    create_table :payroll_manual_allocations do |t|
      t.references :time_entry, null: false, foreign_key: true
      t.references :user, null: false, foreign_key: true
      t.references :recorded_by, null: false, foreign_key: { to_table: :users }
      t.uuid :source_user_uuid, null: false
      t.integer :source_time_entry_version, null: false
      t.date :work_date, null: false
      t.date :pay_date, null: false
      t.bigint :time_category_id
      t.decimal :regular_hours, precision: 8, scale: 2, null: false
      t.decimal :overtime_hours, precision: 8, scale: 2, null: false
      t.string :external_pay_period_id, null: false
      t.string :external_payroll_item_id, null: false
      t.string :payment_method
      t.string :payment_reference
      t.string :status, null: false, default: "committed"
      t.text :reason, null: false
      t.datetime :issued_at
      t.datetime :voided_at
      t.integer :lock_version, null: false, default: 0
      t.timestamps
    end

    add_index :payroll_manual_allocations,
              [ :time_entry_id, :external_payroll_item_id ],
              unique: true,
              name: "index_manual_allocations_on_entry_and_payroll_item"
    add_index :payroll_manual_allocations, [ :external_pay_period_id, :external_payroll_item_id ],
              name: "index_manual_allocations_on_payroll_item"
    add_check_constraint :payroll_manual_allocations,
                         "regular_hours >= 0 AND overtime_hours >= 0 AND regular_hours + overtime_hours > 0",
                         name: "manual_allocation_positive_hours"
    add_check_constraint :payroll_manual_allocations,
                         "status IN ('committed', 'issued', 'voided')",
                         name: "manual_allocation_status"

    create_table :payroll_manual_allocation_events do |t|
      t.references :payroll_manual_allocation, null: false, foreign_key: true, index: { name: "index_manual_allocation_events_on_allocation" }
      t.references :actor, null: false, foreign_key: { to_table: :users }
      t.string :event_type, null: false
      t.datetime :occurred_at, null: false
      t.string :payment_method
      t.string :payment_reference
      t.text :reason, null: false
      t.timestamps
    end
  end
end
