# frozen_string_literal: true

class NormalizePayrollRevisionClocksToUtc < ActiveRecord::Migration[8.1]
  def up
    # Rails stores these ledger instants as UTC timestamp-without-time-zone.
    # Normalize explicitly even when a direct SQL writer changes TimeZone.
    # Existing append-only revisions cannot reveal their writer's timezone;
    # this forward correction preserves them and fixes subsequent capture.
    execute <<~SQL
      CREATE OR REPLACE FUNCTION capture_payroll_manual_allocation_revision()
      RETURNS trigger AS $$
      BEGIN
        INSERT INTO payroll_manual_allocation_revisions
          (payroll_manual_allocation_id, source_time_entry_id, recorded_at, snapshot)
        VALUES (NEW.id, NEW.time_entry_id, (clock_timestamp() AT TIME ZONE 'UTC'), to_jsonb(NEW));
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;

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
          (clock_timestamp() AT TIME ZONE 'UTC'),
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
    SQL
  end

  def down
    raise ActiveRecord::IrreversibleMigration, "Preserve timezone-independent trusted payroll recording clocks"
  end
end
