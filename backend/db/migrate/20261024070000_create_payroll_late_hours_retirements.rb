# frozen_string_literal: true

class CreatePayrollLateHoursRetirements < ActiveRecord::Migration[8.1]
  def up
    execute "SET LOCAL lock_timeout = '5s'"
    create_table :payroll_late_hours_retirements do |t|
      t.uuid :original_command_id, null: false
      t.string :target_external_pay_period_id, null: false
      t.references :origin_payroll_calendar_period, null: false, foreign_key: { to_table: :payroll_calendar_periods }, index: { name: "index_late_hours_retirements_origin" }
      t.references :payroll_batch, foreign_key: true
      t.references :actor, null: false, foreign_key: { to_table: :users }
      t.string :status, null: false
      t.text :reason, null: false
      t.timestamps
    end
    add_index :payroll_late_hours_retirements, :original_command_id, unique: true
    add_index :payroll_late_hours_retirements, :target_external_pay_period_id, unique: true, name: "index_late_hours_retirements_target"
    add_check_constraint :payroll_late_hours_retirements,
      "(status = 'no_claim' AND payroll_batch_id IS NULL) OR (status = 'canceled' AND payroll_batch_id IS NOT NULL)", name: "check_late_hours_retirement_shape"
    add_check_constraint :payroll_late_hours_retirements, "target_external_pay_period_id ~ '^[1-9][0-9]*$' AND length(trim(reason)) > 0", name: "check_late_hours_retirement_intent"
    execute <<~SQL
      CREATE TRIGGER payroll_late_hours_retirements_append_only
      BEFORE UPDATE OR DELETE ON payroll_late_hours_retirements
      FOR EACH ROW EXECUTE FUNCTION protect_finalized_payroll_records();
      CREATE TRIGGER payroll_late_hours_retirements_prevent_truncate
      BEFORE TRUNCATE ON payroll_late_hours_retirements
      FOR EACH STATEMENT EXECUTE FUNCTION protect_finalized_payroll_records();
    SQL
  end

  def down
    raise ActiveRecord::IrreversibleMigration, "Preserve terminal command fences and immutable cancellation evidence"
  end
end
