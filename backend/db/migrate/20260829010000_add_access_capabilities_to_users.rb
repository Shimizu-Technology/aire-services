# frozen_string_literal: true

class AddAccessCapabilitiesToUsers < ActiveRecord::Migration[8.1]
  def up
    add_column :users, :personal_access_enabled, :boolean, default: false, null: false
    add_column :users, :profile_source, :string, default: "local", null: false
    add_column :users, :time_tracking_enabled, :boolean, default: false, null: false

    add_index :users, :personal_access_enabled
    add_index :users, :time_tracking_enabled

    add_check_constraint :users,
                         "profile_source IN ('clerk', 'local')",
                         name: "check_users_profile_source"

    execute <<~SQL.squish
      UPDATE users
      SET personal_access_enabled = TRUE,
          profile_source = CASE
            WHEN clerk_id IS NULL OR clerk_id LIKE 'pending_%' THEN 'local'
            ELSE 'clerk'
          END
      WHERE email IS NOT NULL AND BTRIM(email) <> ''
    SQL

    # Preserve every category a person has actually used before deciding
    # whether they should remain time-tracking enabled. Existing assignments
    # win; historical active categories fill any extraction-era gaps.
    execute <<~SQL.squish
      INSERT INTO user_time_categories (user_id, time_category_id, created_at, updated_at)
      SELECT DISTINCT time_entries.user_id, time_entries.time_category_id, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      FROM time_entries
      INNER JOIN time_categories ON time_categories.id = time_entries.time_category_id
      WHERE time_entries.user_id IS NOT NULL
        AND time_entries.time_category_id IS NOT NULL
        AND time_categories.is_active = TRUE
      ON CONFLICT (user_id, time_category_id) DO NOTHING
    SQL

    execute <<~SQL.squish
      UPDATE users
      SET time_tracking_enabled = TRUE
      WHERE EXISTS (
        SELECT 1
        FROM user_time_categories
        INNER JOIN time_categories ON time_categories.id = user_time_categories.time_category_id
        WHERE user_time_categories.user_id = users.id
          AND time_categories.is_active = TRUE
      )
    SQL

    # A kiosk without an active work category cannot clock in today. Keep the
    # staff record and history, but leave that unusable access disabled until
    # an administrator deliberately completes the new setup.
    execute <<~SQL.squish
      INSERT INTO audit_logs (
        action, auditable_id, auditable_type, changes_made, metadata,
        created_at, updated_at
      )
      SELECT
        'updated', users.id, 'User', '{"kiosk_enabled":[true,false]}'::json,
        'access capability migration: disabled unusable kiosk',
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      FROM users
      WHERE kiosk_enabled = TRUE
        AND time_tracking_enabled = FALSE
    SQL

    execute <<~SQL.squish
      UPDATE users
      SET kiosk_enabled = FALSE
      WHERE kiosk_enabled = TRUE
        AND time_tracking_enabled = FALSE
    SQL
  end

  def down
    execute <<~SQL.squish
      UPDATE users
      SET kiosk_enabled = TRUE
      WHERE id IN (
        SELECT auditable_id
        FROM audit_logs
        WHERE auditable_type = 'User'
          AND metadata = 'access capability migration: disabled unusable kiosk'
      )
    SQL

    execute <<~SQL.squish
      DELETE FROM audit_logs
      WHERE auditable_type = 'User'
        AND metadata = 'access capability migration: disabled unusable kiosk'
    SQL

    remove_check_constraint :users, name: "check_users_profile_source"
    remove_index :users, :time_tracking_enabled
    remove_index :users, :personal_access_enabled
    remove_column :users, :time_tracking_enabled
    remove_column :users, :profile_source
    remove_column :users, :personal_access_enabled
  end
end
