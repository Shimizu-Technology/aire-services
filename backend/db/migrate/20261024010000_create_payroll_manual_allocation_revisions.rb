# frozen_string_literal: true

class CreatePayrollManualAllocationRevisions < ActiveRecord::Migration[8.1]
  def up
    create_table :payroll_manual_allocation_revisions do |t|
      t.bigint :payroll_manual_allocation_id, null: false
      t.bigint :source_time_entry_id, null: false
      t.datetime :recorded_at, null: false
      t.jsonb :snapshot, null: false
    end
    add_index :payroll_manual_allocation_revisions,
      [ :payroll_manual_allocation_id, :recorded_at, :id ], name: "idx_manual_allocation_revisions_recording"
    add_index :payroll_manual_allocation_revisions, :source_time_entry_id

    # Fence writers while installing the trigger and capturing current state.
    # Legacy physical/created_at timestamps cannot prove historical knowledge:
    # their first trusted revision starts here, never at an invented old time.
    execute <<~SQL
      LOCK TABLE payroll_manual_allocations IN SHARE ROW EXCLUSIVE MODE;
      CREATE FUNCTION capture_payroll_manual_allocation_revision()
      RETURNS trigger AS $$
      BEGIN
        INSERT INTO payroll_manual_allocation_revisions
          (payroll_manual_allocation_id, source_time_entry_id, recorded_at, snapshot)
        VALUES (NEW.id, NEW.time_entry_id, (clock_timestamp() AT TIME ZONE 'UTC'), to_jsonb(NEW));
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;

      CREATE TRIGGER capture_payroll_manual_allocation_revision
      AFTER INSERT OR UPDATE ON payroll_manual_allocations
      FOR EACH ROW EXECUTE FUNCTION capture_payroll_manual_allocation_revision();

      INSERT INTO payroll_manual_allocation_revisions
        (payroll_manual_allocation_id, source_time_entry_id, recorded_at, snapshot)
      SELECT id, time_entry_id, (clock_timestamp() AT TIME ZONE 'UTC'), to_jsonb(payroll_manual_allocations)
      FROM payroll_manual_allocations;

      CREATE TRIGGER payroll_manual_allocation_revisions_append_only
      BEFORE UPDATE OR DELETE ON payroll_manual_allocation_revisions
      FOR EACH ROW EXECUTE FUNCTION protect_finalized_payroll_records();
      CREATE TRIGGER payroll_manual_allocation_revisions_prevent_truncate
      BEFORE TRUNCATE ON payroll_manual_allocation_revisions
      FOR EACH STATEMENT EXECUTE FUNCTION protect_finalized_payroll_records();
    SQL
  end

  def down
    raise ActiveRecord::IrreversibleMigration, "Preserve trusted reservation history; use a forward correction"
  end
end
