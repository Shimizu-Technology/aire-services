# frozen_string_literal: true

class AlignTimeTrackingAndKioskAccess < ActiveRecord::Migration[8.1]
  def up
    # A kiosk-only person with no PIN cannot repair their own access. Preserve
    # their record and history, but deactivate the unusable setup so an admin
    # must deliberately complete it before they can clock in.
    execute <<~SQL.squish
      INSERT INTO audit_logs (
        action, auditable_id, auditable_type, changes_made, metadata,
        created_at, updated_at
      )
      SELECT
        'updated', users.id, 'User',
        json_build_object(
          'time_tracking_enabled', json_build_array(users.time_tracking_enabled, FALSE),
          'kiosk_enabled', json_build_array(users.kiosk_enabled, FALSE),
          'is_active', json_build_array(users.is_active, FALSE)
        ),
        'access capability migration: disabled kiosk-only user without PIN',
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      FROM users
      WHERE personal_access_enabled = FALSE
        AND time_tracking_enabled = TRUE
        AND (kiosk_pin_digest IS NULL OR BTRIM(kiosk_pin_digest) = '')
    SQL

    execute <<~SQL.squish
      UPDATE users
      SET time_tracking_enabled = FALSE,
          kiosk_enabled = FALSE,
          is_active = FALSE
      WHERE personal_access_enabled = FALSE
        AND time_tracking_enabled = TRUE
        AND (kiosk_pin_digest IS NULL OR BTRIM(kiosk_pin_digest) = '')
    SQL

    execute <<~SQL.squish
      INSERT INTO audit_logs (
        action, auditable_id, auditable_type, changes_made, metadata,
        created_at, updated_at
      )
      SELECT
        'updated', users.id, 'User',
        json_build_object('kiosk_enabled', json_build_array(users.kiosk_enabled, users.time_tracking_enabled)),
        'access capability migration: aligned kiosk with time tracking',
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      FROM users
      WHERE kiosk_enabled <> time_tracking_enabled
    SQL

    execute <<~SQL.squish
      UPDATE users
      SET kiosk_enabled = time_tracking_enabled
      WHERE kiosk_enabled <> time_tracking_enabled
    SQL

    add_check_constraint :users,
                         "kiosk_enabled = time_tracking_enabled",
                         name: "check_users_kiosk_matches_time_tracking"
  end

  def down
    remove_check_constraint :users, name: "check_users_kiosk_matches_time_tracking"

    # Restore only rows this migration aligned. The JSON snapshot preserves the
    # original boolean even if the migration is rolled back after later edits.
    execute <<~SQL.squish
      UPDATE users
      SET kiosk_enabled = (audit_logs.changes_made->'kiosk_enabled'->>0)::boolean
      FROM audit_logs
      WHERE audit_logs.auditable_type = 'User'
        AND audit_logs.auditable_id = users.id
        AND audit_logs.metadata = 'access capability migration: aligned kiosk with time tracking'
    SQL

    execute <<~SQL.squish
      UPDATE users
      SET time_tracking_enabled = (audit_logs.changes_made->'time_tracking_enabled'->>0)::boolean,
          kiosk_enabled = (audit_logs.changes_made->'kiosk_enabled'->>0)::boolean,
          is_active = (audit_logs.changes_made->'is_active'->>0)::boolean
      FROM audit_logs
      WHERE audit_logs.auditable_type = 'User'
        AND audit_logs.auditable_id = users.id
        AND audit_logs.metadata = 'access capability migration: disabled kiosk-only user without PIN'
    SQL

    execute <<~SQL.squish
      DELETE FROM audit_logs
      WHERE auditable_type = 'User'
        AND metadata IN (
          'access capability migration: aligned kiosk with time tracking',
          'access capability migration: disabled kiosk-only user without PIN'
        )
    SQL
  end
end
