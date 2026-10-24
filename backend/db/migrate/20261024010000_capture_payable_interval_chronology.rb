# frozen_string_literal: true

class CapturePayableIntervalChronology < ActiveRecord::Migration[8.1]
  def up
    add_column :payroll_batches, :allocation_contract_version, :string
    add_column :time_entries, :overtime_allocation_signature, :jsonb
    add_column :time_entries, :allocation_contract_version, :string
    execute <<~SQL
      SET LOCAL lock_timeout = '5s';
      LOCK TABLE time_entries, time_entry_breaks IN SHARE ROW EXCLUSIVE MODE;
      CREATE OR REPLACE FUNCTION capture_payroll_time_entry_revision()
      RETURNS trigger AS $$
      DECLARE
        source_row time_entries%ROWTYPE;
        source_deleted boolean;
      BEGIN
        IF TG_OP = 'DELETE' THEN
          source_row := OLD;
          source_deleted := TRUE;
        ELSE
          source_row := NEW;
          source_deleted := FALSE;
        END IF;

        INSERT INTO payroll_time_entry_revisions (
          source_time_entry_id,
          source_version,
          source_user_id,
          source_work_date,
          deleted,
          recorded_at,
          snapshot
        )
        SELECT
          source_row.id,
          source_row.lock_version,
          source_row.user_id,
          source_row.work_date,
          source_deleted,
          clock_timestamp(),
          jsonb_build_object(
            'time_entry', to_jsonb(source_row),
            'breaks', COALESCE((SELECT jsonb_agg(to_jsonb(b) ORDER BY b.start_time, b.id) FROM time_entry_breaks b WHERE b.time_entry_id = source_row.id), '[]'::jsonb),
            'user', jsonb_build_object(
              'id', users.id,
              'payroll_integration_uuid', users.payroll_integration_uuid,
              'first_name', users.first_name,
              'last_name', users.last_name,
              'email', users.email,
              'role', users.role
            ),
            'time_category', CASE
              WHEN time_categories.id IS NULL THEN NULL
              ELSE jsonb_build_object(
                'id', time_categories.id,
                'key', time_categories.key,
                'name', time_categories.name
              )
            END
          )
        FROM users
        LEFT JOIN time_categories ON time_categories.id = source_row.time_category_id
        WHERE users.id = source_row.user_id;

        IF TG_OP = 'DELETE' THEN
          RETURN OLD;
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;


      CREATE FUNCTION capture_payroll_break_revision() RETURNS trigger AS $$
      BEGIN
        -- Touching the source creates a new immutable entry+break snapshot at
        -- the database clock, including break-only inserts/updates/deletes.
        IF TG_OP <> 'INSERT' THEN
          UPDATE time_entries SET updated_at = clock_timestamp(), lock_version = lock_version + 1 WHERE id = OLD.time_entry_id;
        END IF;
        IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND NEW.time_entry_id <> OLD.time_entry_id) THEN
          UPDATE time_entries SET updated_at = clock_timestamp(), lock_version = lock_version + 1 WHERE id = NEW.time_entry_id;
        END IF;
        RETURN NULL;
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER time_entry_breaks_capture_payroll_revision
      AFTER INSERT OR UPDATE OR DELETE ON time_entry_breaks
      FOR EACH ROW EXECUTE FUNCTION capture_payroll_break_revision();
      -- This is an observation now, not invented pre-migration chronology.
      UPDATE time_entries SET updated_at = updated_at;
    SQL
  end

  def down
    raise ActiveRecord::IrreversibleMigration, "Append-only break chronology must be retained"
  end
end
