# frozen_string_literal: true

class CreatePayrollObligationCorrections < ActiveRecord::Migration[8.1]
  def change
    create_table :payroll_obligation_corrections do |t|
      t.references :payroll_batch_entry, null: false, foreign_key: true
      t.references :predecessor_event, null: false, foreign_key: { to_table: :payroll_entry_processing_events }, index: { unique: true }
      t.string :command_id, null: false, index: { unique: true }
      t.string :request_digest, null: false
      t.string :external_system, null: false
      t.string :successor_pay_period_id, null: false
      t.string :successor_payroll_item_id, null: false
      t.jsonb :command, null: false
      t.datetime :created_at, null: false
    end
    add_index :payroll_obligation_corrections,
              [ :payroll_batch_entry_id, :external_system, :successor_pay_period_id, :successor_payroll_item_id ],
              unique: true, name: "index_obligation_corrections_successor"
    add_check_constraint :payroll_obligation_corrections, "request_digest ~ '^[0-9a-f]{64}$'", name: "check_obligation_correction_digest"
    add_check_constraint :payroll_obligation_corrections, "jsonb_typeof(command) = 'object' AND command->>'contract' = 'payroll_obligation_correction_v1'", name: "check_obligation_correction_contract"
    add_reference :payroll_entry_processing_events, :payroll_obligation_correction, foreign_key: true
    reversible do |direction|
      direction.up do
        execute <<~SQL
          CREATE TRIGGER payroll_obligation_corrections_append_only
          BEFORE UPDATE OR DELETE ON payroll_obligation_corrections
          FOR EACH ROW EXECUTE FUNCTION protect_finalized_payroll_records();
          CREATE TRIGGER payroll_obligation_corrections_prevent_truncate
          BEFORE TRUNCATE ON payroll_obligation_corrections
          FOR EACH STATEMENT EXECUTE FUNCTION protect_finalized_payroll_records();
        SQL
      end
      direction.down do
        execute <<~SQL
          DROP TRIGGER IF EXISTS payroll_obligation_corrections_append_only ON payroll_obligation_corrections;
          DROP TRIGGER IF EXISTS payroll_obligation_corrections_prevent_truncate ON payroll_obligation_corrections;
        SQL
      end
    end
  end
end
