# frozen_string_literal: true

class CloseOvertimeOnDeniedShifts < ActiveRecord::Migration[8.1]
  def up
    execute "SET LOCAL lock_timeout = '5s'"
    # Only close an already-denied shift's orphan review. No callbacks, hours,
    # allocation changes or model code: safe before the new app instance starts.
    execute <<~SQL
      WITH closed AS (
        UPDATE time_entries
        SET overtime_status = 'denied', updated_at = CURRENT_TIMESTAMP,
            lock_version = lock_version + 1
        WHERE approval_status = 'denied' AND overtime_status = 'pending'
        RETURNING id, user_id, work_date
      )
      INSERT INTO audit_logs (
        auditable_type, auditable_id, action, user_id, actor_kind, actor_name,
        source, event_category, outcome, occurred_at, created_at, updated_at,
        changes_made, metadata
      )
      SELECT 'TimeEntry', id, 'time_entry.overtime_denied', NULL, 'system', 'System',
             'system', 'approvals', 'denied', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP,
             jsonb_build_object('overtime_status', jsonb_build_object('from', 'pending', 'to', 'denied')),
             jsonb_build_object('employee_id', user_id, 'work_date', work_date,
               'review_note', 'Closed with the shift''s earlier denial',
               'migration', '20261114140000_close_overtime_on_denied_shifts')
      FROM closed
    SQL
  end

  def down
    # A closed review must not be reopened on rollback; this data repair is permanent.
  end
end
