# frozen_string_literal: true

class DeactivateStaffWithoutAccess < ActiveRecord::Migration[8.1]
  def up
    # Legacy records can predate both Clerk access and usable kiosk setup. Keep
    # their identity and time history, but fail closed instead of leaving an
    # active employee who cannot satisfy the new access invariant.
    execute <<~SQL.squish
      INSERT INTO audit_logs (
        action, auditable_id, auditable_type, changes_made, metadata,
        created_at, updated_at
      )
      SELECT
        'updated', users.id, 'User', '{"is_active":[true,false]}'::json,
        'access capability migration: deactivated staff without access',
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      FROM users
      WHERE is_active = TRUE
        AND personal_access_enabled = FALSE
        AND kiosk_enabled = FALSE
    SQL

    execute <<~SQL.squish
      UPDATE users
      SET is_active = FALSE
      WHERE is_active = TRUE
        AND personal_access_enabled = FALSE
        AND kiosk_enabled = FALSE
    SQL
  end

  def down
    execute <<~SQL.squish
      UPDATE users
      SET is_active = TRUE
      WHERE id IN (
        SELECT auditable_id
        FROM audit_logs
        WHERE auditable_type = 'User'
          AND metadata = 'access capability migration: deactivated staff without access'
      )
    SQL

    execute <<~SQL.squish
      DELETE FROM audit_logs
      WHERE auditable_type = 'User'
        AND metadata = 'access capability migration: deactivated staff without access'
    SQL
  end
end
