# frozen_string_literal: true

class CreatePayrollBatches < ActiveRecord::Migration[8.1]
  def change
    create_table :payroll_batches do |t|
      t.string :public_id, null: false
      t.date :start_date, null: false
      t.date :end_date, null: false
      t.datetime :cutoff_at, null: false
      t.datetime :finalized_at, null: false
      t.references :finalized_by, foreign_key: { to_table: :users, on_delete: :nullify }
      t.string :schema_version, null: false, default: "2.0"
      t.string :checksum, null: false
      t.jsonb :payload, null: false, default: {}
      t.jsonb :summary, null: false, default: {}
      t.jsonb :issues, null: false, default: {}
      t.timestamps
    end

    add_index :payroll_batches, :public_id, unique: true
    add_index :payroll_batches, [ :start_date, :end_date ], unique: true
    add_index :payroll_batches, :cutoff_at
    add_check_constraint :payroll_batches, "end_date >= start_date", name: "check_payroll_batches_date_order"

    create_table :payroll_batch_entries do |t|
      t.references :payroll_batch, null: false, foreign_key: { on_delete: :cascade }
      t.bigint :source_time_entry_id, null: false
      t.bigint :source_user_id, null: false
      t.bigint :source_category_id
      t.date :work_date, null: false
      t.date :week_start, null: false
      t.decimal :total_hours, precision: 8, scale: 2, null: false, default: 0
      t.decimal :regular_hours, precision: 8, scale: 2, null: false, default: 0
      t.decimal :overtime_hours, precision: 8, scale: 2, null: false, default: 0
      t.integer :effective_rate_cents
      t.string :source_kind, null: false
      t.string :line_key, null: false
      t.jsonb :snapshot, null: false, default: {}
      t.timestamps
    end

    add_index :payroll_batch_entries,
              [ :payroll_batch_id, :source_time_entry_id, :line_key ],
              unique: true,
              name: "index_payroll_batch_entries_on_batch_source_line"
    add_index :payroll_batch_entries, [ :source_user_id, :week_start ], name: "index_payroll_batch_entries_on_user_and_week"
    add_index :payroll_batch_entries, :source_time_entry_id

    create_table :payroll_batch_exclusions do |t|
      t.references :payroll_batch, null: false, foreign_key: { on_delete: :cascade }
      t.bigint :source_time_entry_id, null: false
      t.bigint :source_user_id, null: false
      t.string :reason, null: false
      t.decimal :held_total_hours, precision: 8, scale: 2, null: false, default: 0
      t.decimal :held_regular_hours, precision: 8, scale: 2, null: false, default: 0
      t.decimal :held_overtime_hours, precision: 8, scale: 2, null: false, default: 0
      t.string :first_excluded_batch_public_id
      t.jsonb :snapshot, null: false, default: {}
      t.timestamps
    end

    add_index :payroll_batch_exclusions,
              [ :payroll_batch_id, :source_time_entry_id, :reason ],
              unique: true,
              name: "index_payroll_batch_exclusions_on_batch_source_reason"
    add_index :payroll_batch_exclusions, :source_time_entry_id

    reversible do |direction|
      direction.up do
        execute <<~SQL
          CREATE OR REPLACE FUNCTION protect_finalized_payroll_records()
          RETURNS trigger AS $$
          BEGIN
            IF TG_TABLE_NAME = 'payroll_batches'
               AND TG_OP = 'UPDATE'
               AND (to_jsonb(NEW)->>'finalized_by_id') IS NULL
               AND (to_jsonb(OLD)->>'finalized_by_id') IS NOT NULL
               AND (to_jsonb(NEW) - 'finalized_by_id') = (to_jsonb(OLD) - 'finalized_by_id') THEN
              RETURN NEW;
            END IF;

            RAISE EXCEPTION 'finalized payroll records are append-only';
          END;
          $$ LANGUAGE plpgsql;

          CREATE TRIGGER payroll_batches_append_only
          BEFORE UPDATE OR DELETE ON payroll_batches
          FOR EACH ROW EXECUTE FUNCTION protect_finalized_payroll_records();

          CREATE TRIGGER payroll_batch_entries_append_only
          BEFORE UPDATE OR DELETE ON payroll_batch_entries
          FOR EACH ROW EXECUTE FUNCTION protect_finalized_payroll_records();

          CREATE TRIGGER payroll_batch_exclusions_append_only
          BEFORE UPDATE OR DELETE ON payroll_batch_exclusions
          FOR EACH ROW EXECUTE FUNCTION protect_finalized_payroll_records();
        SQL
      end

      direction.down do
        execute "DROP TRIGGER IF EXISTS payroll_batch_exclusions_append_only ON payroll_batch_exclusions"
        execute "DROP TRIGGER IF EXISTS payroll_batch_entries_append_only ON payroll_batch_entries"
        execute "DROP TRIGGER IF EXISTS payroll_batches_append_only ON payroll_batches"
        execute "DROP FUNCTION IF EXISTS protect_finalized_payroll_records()"
      end
    end
  end
end
