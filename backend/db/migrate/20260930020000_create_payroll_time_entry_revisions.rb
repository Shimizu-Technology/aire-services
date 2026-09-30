# frozen_string_literal: true

class CreatePayrollTimeEntryRevisions < ActiveRecord::Migration[8.1]
  def up
    create_table :payroll_time_entry_revisions do |t|
      t.bigint :source_time_entry_id, null: false
      t.integer :source_version, null: false
      t.bigint :source_user_id, null: false
      t.date :source_work_date, null: false
      t.boolean :deleted, null: false, default: false
      t.datetime :recorded_at, null: false
      t.jsonb :snapshot, null: false, default: {}
    end

    add_index :payroll_time_entry_revisions,
              [ :source_time_entry_id, :recorded_at, :id ],
              name: "idx_payroll_time_entry_revisions_entry_time"
    add_index :payroll_time_entry_revisions,
              [ :source_user_id, :source_work_date, :recorded_at ],
              name: "idx_payroll_time_entry_revisions_user_work_time"
    add_check_constraint :payroll_time_entry_revisions,
                         "jsonb_typeof(snapshot) = 'object'",
                         name: "check_payroll_time_entry_revisions_snapshot"

    execute <<~SQL
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

      -- Keep the backfill and trigger installation gap-free. Existing writes
      -- finish first; new writes resume after the trigger is active.
      LOCK TABLE time_entries IN SHARE MODE;

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
        time_entries.id,
        time_entries.lock_version,
        time_entries.user_id,
        time_entries.work_date,
        FALSE,
        clock_timestamp(),
        jsonb_build_object(
          'time_entry', to_jsonb(time_entries),
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
      FROM time_entries
      INNER JOIN users ON users.id = time_entries.user_id
      LEFT JOIN time_categories ON time_categories.id = time_entries.time_category_id;

      CREATE TRIGGER time_entries_capture_payroll_revision
      AFTER INSERT OR UPDATE OR DELETE ON time_entries
      FOR EACH ROW EXECUTE FUNCTION capture_payroll_time_entry_revision();

      CREATE TRIGGER payroll_time_entry_revisions_append_only
      BEFORE UPDATE OR DELETE ON payroll_time_entry_revisions
      FOR EACH ROW EXECUTE FUNCTION protect_finalized_payroll_records();

      CREATE TRIGGER payroll_time_entry_revisions_prevent_truncate
      BEFORE TRUNCATE ON payroll_time_entry_revisions
      FOR EACH STATEMENT EXECUTE FUNCTION protect_finalized_payroll_records();
    SQL
  end

  def down
    execute <<~SQL
      DROP TRIGGER IF EXISTS time_entries_capture_payroll_revision ON time_entries;
      DROP TRIGGER IF EXISTS payroll_time_entry_revisions_append_only ON payroll_time_entry_revisions;
      DROP TRIGGER IF EXISTS payroll_time_entry_revisions_prevent_truncate ON payroll_time_entry_revisions;
      DROP FUNCTION IF EXISTS capture_payroll_time_entry_revision();
    SQL
    drop_table :payroll_time_entry_revisions
  end
end
